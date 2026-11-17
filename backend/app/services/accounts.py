"""Password accounts and revocable sessions over isolated workspace databases."""
import base64
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import threading
import time
import unicodedata
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import ForeignKey, String, delete, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from ..database import UTCDateTime, create_sqlite_engine
from ..models import AssistantMessage, AssistantRun, utc_now

COOKIE_NAME = 'sga_session'
SESSION_SECONDS = 7 * 24 * 3600
PASSWORD_ROUNDS = 600_000
_schema_lock = threading.Lock()


class AccountBase(DeclarativeBase):
    pass


class Account(AccountBase):
    __tablename__ = 'accounts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account: Mapped[str] = mapped_column(String(120), nullable=False)
    account_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    workspace_key: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)


class AccountSession(AccountBase):
    __tablename__ = 'account_sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


@dataclass(frozen=True)
class Identity:
    id: str
    account: str
    workspace_key: str

    def public(self):
        return {'id': self.id, 'account': self.account}


def fail(code, message, status=400):
    raise HTTPException(status, detail={'code': code, 'message': message})


def account_name(value):
    name = unicodedata.normalize('NFKC', value).strip()
    if not name or len(name) > 120 or any(unicodedata.category(char).startswith('C') for char in name):
        fail('ACCOUNT_INVALID', '请输入有效的用户名或邮箱，最多120个字符。', 422)
    return name


def password_hash(password, salt=None):
    if not password or len(password.encode('utf-8')) > 1024:
        fail('PASSWORD_INVALID', '请输入密码，长度最多1024字节。', 422)
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PASSWORD_ROUNDS)
    return 'pbkdf2_sha256${}${}${}'.format(PASSWORD_ROUNDS,
        base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password, encoded):
    # Unknown accounts perform the same work as an incorrect password.
    encoded = encoded or 'pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    try:
        algorithm, rounds, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or int(rounds) != PASSWORD_ROUNDS:
            return False
        if not password or len(password.encode('utf-8')) > 1024:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), base64.b64decode(salt), int(rounds))
        return hmac.compare_digest(actual, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def identity(row):
    return Identity(row.id, row.account, row.workspace_key)


class AccountStore:
    def __init__(self, legacy_engine):
        self.legacy_engine = legacy_engine
        self.base_path = Path(legacy_engine.url.database).resolve()
        self.workspace_dir = self.base_path.parent / (self.base_path.stem + '.users')
        registry = self.base_path.with_name(self.base_path.stem + '.accounts.db')
        self.engine = create_sqlite_engine('sqlite:///' + registry.as_posix())
        self._lock = threading.RLock()
        self._engines = {'legacy': legacy_engine}
        self._attempts = defaultdict(deque)
        # The separate account registry has its own schema version. Workspace
        # exports/restores continue to contain business records only.
        with self.engine.begin() as connection:
            connection.exec_driver_sql('BEGIN IMMEDIATE')
            version = connection.exec_driver_sql('PRAGMA user_version').scalar()
            if version not in (0, 1):
                raise RuntimeError('Unsupported account registry version')
            AccountBase.metadata.create_all(connection)
            connection.exec_driver_sql('PRAGMA user_version=1')
        if os.getenv('SGA_AUTO_BACKUP', '1') != '0':
            from .growth_data import create_daily_backup
            create_daily_backup(self.engine)

    def guard_attempt(self, action, host):
        now = time.monotonic()
        with self._lock:
            for key in list(self._attempts):
                if not self._attempts[key] or self._attempts[key][-1] < now - 60:
                    del self._attempts[key]
            queue = self._attempts[(action, host)]
            while queue and queue[0] < now - 60:
                queue.popleft()
            if len(queue) >= 30:
                fail('AUTH_RATE_LIMITED', '尝试次数较多，请一分钟后再试。', 429)
            queue.append(now)

    def _session(self, db, account_id):
        token = secrets.token_urlsafe(32)
        db.execute(delete(AccountSession).where(AccountSession.expires_at <= utc_now()))
        db.add(AccountSession(token_hash=token_hash(token), account_id=account_id,
            expires_at=utc_now() + timedelta(seconds=SESSION_SECONDS)))
        return token

    def register(self, name, password, *, legacy=False):
        name = account_name(name)
        encoded = password_hash(password)
        with self._lock, Session(self.engine) as db:
            db.execute(text('BEGIN IMMEDIATE'))
            if db.scalar(select(Account.id).where(Account.account_key == name.casefold())):
                fail('ACCOUNT_EXISTS', '这个账号已注册，请登录或换一个账号。', 409)
            if legacy and db.scalar(select(Account.id).where(Account.workspace_key == 'legacy')):
                fail('WORKSPACE_ALREADY_BOUND', '现有工作区已经绑定账号。', 409)
            user_id = str(uuid4())
            workspace_key = 'legacy' if legacy else user_id
            self.workspace_engine(Identity(user_id, name, workspace_key))
            row = Account(id=user_id, account=name, account_key=name.casefold(),
                password_hash=encoded, workspace_key=workspace_key)
            db.add(row)
            db.flush()
            token = self._session(db, user_id)
            db.commit()
            return identity(row), token

    def login(self, name, password):
        name = account_name(name)
        with Session(self.engine) as db:
            row = db.scalar(select(Account).where(Account.account_key == name.casefold()))
            matches = verify_password(password, row.password_hash if row else None)
            if not row or not matches:
                fail('INVALID_CREDENTIALS', '账号或密码不正确。', 401)
            token = self._session(db, row.id)
            db.commit()
            return identity(row), token

    def current(self, token):
        if not token or len(token) > 128:
            return None
        with Session(self.engine) as db:
            row = db.scalar(select(Account).join(AccountSession).where(
                AccountSession.token_hash == token_hash(token), AccountSession.expires_at > utc_now()))
            return identity(row) if row else None

    def logout(self, token):
        if token:
            with Session(self.engine) as db:
                db.execute(delete(AccountSession).where(AccountSession.token_hash == token_hash(token)))
                db.commit()

    def workspace_engine(self, user):
        with self._lock:
            if user.workspace_key in self._engines:
                return self._engines[user.workspace_key]
            if str(UUID(user.workspace_key)) != user.workspace_key:
                raise RuntimeError('Invalid workspace identity')
            self.workspace_dir.mkdir(parents=True, exist_ok=True)
            path = self.workspace_dir / (user.workspace_key + '.db')
            workspace = create_sqlite_engine('sqlite:///' + path.as_posix())
            try:
                from .schema_migrations import upgrade_database
                from .growth_data import create_daily_backup
                from .growth_migrations import apply_growth_migrations
                from .planning_state import get_or_create_planning_state
                # Alembic's Python context is process-global.
                with _schema_lock:
                    if os.getenv('SGA_AUTO_BACKUP', '1') != '0':
                        create_daily_backup(workspace)
                    upgrade_database(workspace)
                    with Session(workspace) as db:
                        apply_growth_migrations(db)
                        get_or_create_planning_state(db)
                        for run in db.scalars(select(AssistantRun).where(AssistantRun.status == 'running')):
                            run.status = 'interrupted'
                            run.phase = 'interrupted'
                            if run.payload.get('kind') == 'conversation':
                                message = db.get(AssistantMessage, run.payload.get('assistant_message_id'))
                                if message:
                                    message.content = {**(message.content or {}), 'status': 'interrupted'}
                        db.commit()
            except BaseException:
                workspace.dispose()
                raise
            self._engines[user.workspace_key] = workspace
            return workspace

    def workspace_engines(self):
        with self._lock:
            return list(self._engines.values())

    def close(self):
        for workspace in self.workspace_engines():
            if workspace is not self.legacy_engine:
                workspace.dispose()
        self.engine.dispose()
