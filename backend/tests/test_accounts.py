"""Real password/session handling and cross-account isolation, with Mock AI."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.models import Task, WorkspaceMetadata, utc_now
from app.services.accounts import Account, AccountSession, COOKIE_NAME, verify_password
from app.services import conversation_runs, conversation_tools
from app.workspace_schemas import ToolPlan


@pytest.fixture
def account_clients(test_engine, monkeypatch):
    original_engine = app.state.db_engine
    original_auth = app.state.auth_required
    original_override = app.dependency_overrides.pop(get_db, None)
    app.state.db_engine = test_engine
    app.state.auth_required = True
    async def reply(request):
        yield {'type': 'delta', 'text': '这条回复属于当前账号。'}
    monkeypatch.setattr(conversation_runs, 'reply_events', reply)
    try:
        with TestClient(app) as first:
            second = TestClient(app)
            anonymous = TestClient(app)
            try:
                yield first, second, anonymous, app.state.accounts
            finally:
                second.close()
                anonymous.close()
    finally:
        app.state.db_engine = original_engine
        app.state.auth_required = original_auth
        if original_override is not None:
            app.dependency_overrides[get_db] = original_override


def register(client, name='alice', password='test-password'):
    response = client.post('/api/auth/register', json={'account': name, 'password': password})
    assert response.status_code == 201, response.text
    return response.json()['user']


def conversation(client, title='自己的聊天'):
    response = client.post('/api/conversations', json={'client_request_id': title, 'title': title})
    assert response.status_code == 201, response.text
    return response.json()['id']


def test_authentication_required_on_business_and_speech_routes(account_clients):
    _, _, anonymous, _ = account_clients
    for path in ['/api/tasks', '/api/conversations', '/api/assistant/settings',
            '/api/growth/profile', '/api/assistant/preference-rules', '/api/data/export', '/api/speech/config']:
        response = anonymous.get(path)
        assert response.status_code == 401
        assert response.json()['detail']['code'] == 'AUTH_REQUIRED'
    assert anonymous.get('/api/health').status_code == 200
    assert anonymous.get('/api/auth/session').json() == {'required': True, 'user': None}
    with pytest.raises(Exception) as error:
        with anonymous.websocket_connect('/api/speech/realtime'):
            pass
    assert getattr(error.value, 'code', None) == 1008


def test_registration_cookie_password_hash_login_and_revocation(account_clients):
    first, _, anonymous, store = account_clients
    user = register(first)
    assert set(user) == {'id', 'account'}
    assert first.get('/api/auth/session').json()['user'] == user
    assert first.get('/api/tasks').headers['cache-control'] == 'no-store'
    token = first.cookies.get(COOKIE_NAME)
    cookie = next(cookie for cookie in first.cookies.jar if cookie.name == COOKIE_NAME)
    assert cookie.path == '/api'
    assert cookie.has_nonstandard_attr('HttpOnly')
    with Session(store.engine) as db:
        account = db.scalar(select(Account))
        session = db.scalar(select(AccountSession))
        assert account.password_hash != 'test-password'
        assert verify_password('test-password', account.password_hash)
        assert session.token_hash != token and len(session.token_hash) == 64
    assert first.post('/api/auth/logout').json() == {'status': 'signed_out'}
    assert first.get('/api/tasks').status_code == 401
    assert anonymous.get('/api/tasks', headers={'Cookie': f'{COOKIE_NAME}={token}'}).status_code == 401
    assert first.post('/api/auth/logout').status_code == 200
    assert first.post('/api/auth/login', json={'account': 'ALICE', 'password': 'wrong'}).status_code == 401
    response = first.post('/api/auth/login', json={'account': ' ALICE ', 'password': 'test-password'})
    assert response.status_code == 200
    assert first.get('/api/tasks').status_code == 200


def test_duplicate_names_and_invalid_credentials_cannot_create_accounts(account_clients):
    first, second, _, store = account_clients
    register(first)
    assert second.post('/api/auth/register', json={'account': ' ALICE ', 'password': 'other'}).status_code == 409
    assert second.post('/api/auth/register', json={'account': 'empty', 'password': ''}).status_code == 422
    assert second.post('/api/auth/register', json={'account': '   ', 'password': 'other'}).status_code == 422
    assert second.post('/api/auth/register', json={'account': 'x', 'password': 'other', 'legacy': True}).status_code == 422
    assert second.post('/api/auth/login', json={'account': 'unknown', 'password': 'wrong'}).status_code == 401
    assert store.current('invalid') is None
    with Session(store.engine) as db:
        assert len(db.scalars(select(Account)).all()) == 1


def test_new_accounts_isolate_all_workspace_records_and_id_collisions(account_clients):
    first, second, _, _ = account_clients
    first_user = register(first)
    first_settings = first.get('/api/assistant/settings').json()
    task = first.post('/api/tasks', json={'title': 'Alice 的任务', 'duration_minutes': 30,
        'deadline': '2026-10-15T22:00:00+08:00'}).json()
    sid = conversation(first, 'Alice 的聊天')
    first.post(f'/api/conversations/{sid}/messages', json={'client_message_id': 'one', 'text': 'Alice 的历史'})
    goal = first.post('/api/goals', json={'title': 'Alice 的目标', 'metric_kind': 'count', 'weekly_target': 2})
    assert goal.status_code < 300, goal.text
    category = first.post('/api/task-categories', json={'name': 'Alice 专属类别'}).json()
    preference = first.post('/api/assistant/preference-rules', json={'name': 'Alice 的偏好', 'kind': 'prefer_time',
        'category_key': category['key'], 'weekdays': [1,2,3,4,5], 'parameters': {'start': '11:00', 'end': '12:00'}})
    assert preference.status_code == 201
    register(second, 'bob')
    assert second.get('/api/tasks').json() == []
    assert second.get('/api/conversations').json()['items'] == []
    assert second.get(f'/api/conversations/{sid}').status_code == 404
    assert second.get(f'/api/tasks/{task["id"]}/growth-context').status_code == 404
    assert second.get('/api/assistant/settings').json()['workspace_id'] != first_settings['workspace_id']
    exported = second.get('/api/data/export').json()['tables']
    assert exported['tasks'] == [] and exported['growth_goals'] == []
    assert not any(row['name'] == 'Alice 的偏好' for row in exported['preference_rules'])
    assert 'accounts' not in exported and 'account_sessions' not in exported
    second_task = second.post('/api/tasks', json={'title': 'Bob 的任务', 'duration_minutes': 45,
        'deadline': '2026-10-15T22:00:00+08:00'}).json()
    assert second_task['id'] == task['id']
    assert first.get('/api/tasks').json()[0]['title'] == 'Alice 的任务'
    assert second.get('/api/tasks', headers={'X-Account-Id': first_user['id']}).status_code == 409


def test_legacy_workspace_binding_keeps_existing_records(account_clients):
    first, second, _, store = account_clients
    with Session(store.legacy_engine) as db:
        original = db.get(WorkspaceMetadata, 1).workspace_id
        db.add(Task(title='已有数据', duration_minutes=30, deadline=utc_now()+timedelta(days=1)))
        db.commit()
    store.register('owner', 'owner-password', legacy=True)
    assert first.post('/api/auth/login', json={'account':'owner','password':'owner-password'}).status_code == 200
    assert first.get('/api/tasks').json()[0]['title'] == '已有数据'
    assert first.get('/api/assistant/settings').json()['workspace_id'] == original
    register(second, 'new-user')
    assert second.get('/api/tasks').json() == []
    with pytest.raises(HTTPException) as error:
        store.register('second-owner', 'password', legacy=True)
    assert error.value.status_code == 409


def test_expired_session_foreign_origin_and_workspace_restore_are_scoped(account_clients):
    first, second, _, store = account_clients
    register(first)
    snapshot = first.get('/api/data/export').json()
    assert first.post('/api/auth/logout', headers={'Origin':'https://untrusted.example'}).status_code == 403
    assert first.get('/api/tasks').status_code == 200
    assert first.post('/api/data/import', json=snapshot).status_code == 200
    assert first.get('/api/auth/session').json()['user']['account'] == 'alice'
    register(second, 'bob')
    with Session(store.engine) as db:
        for row in db.scalars(select(AccountSession)):
            row.expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
    assert first.get('/api/tasks').status_code == 401
    assert second.get('/api/tasks').status_code == 401


def test_concurrent_duplicate_registration_produces_one_account(account_clients):
    _, _, _, store = account_clients
    def create():
        try:
            return store.register('concurrent', 'password')[0].id
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: create(), range(2)))
    assert results.count(409) == 1
    with Session(store.engine) as db:
        assert len(db.scalars(select(Account)).all()) == 1


def test_password_and_account_details_are_not_stored_as_plaintext(account_clients):
    first, _, _, store = account_clients
    response = first.post('/api/auth/register', json={'account':'secret-check','password':'unique-test-password'})
    assert response.status_code == 201
    assert 'unique-test-password' not in response.text
    with open(store.engine.url.database, 'rb') as database:
        assert b'unique-test-password' not in database.read()


def test_same_run_ids_cannot_cancel_other_workspace_tasks(account_clients, monkeypatch):
    from types import SimpleNamespace
    from app.routers import assistant
    first, second, _, store = account_clients
    register(first)
    register(second, 'bob')
    alice = store.current(first.cookies.get(COOKIE_NAME))
    bob = store.current(second.cookies.get(COOKIE_NAME))
    alice_engine = store.workspace_engine(alice)
    bob_engine = store.workspace_engine(bob)
    async def pending(engine, run_id):
        await asyncio.sleep(60)
    monkeypatch.setattr(assistant, '_process_run', pending)
    async def check():
        assistant._launch_run(SimpleNamespace(get_bind=lambda: alice_engine), 1)
        assistant._launch_run(SimpleNamespace(get_bind=lambda: bob_engine), 1)
        await asyncio.sleep(0)
        first_task = assistant._run_tasks[(alice_engine, 1)]
        second_task = assistant._run_tasks[(bob_engine, 1)]
        first_task.cancel()
        await asyncio.gather(first_task, return_exceptions=True)
        assert not second_task.done()
        await assistant.shutdown_runs(bob_engine)
    asyncio.run(check())
