"""Create a local account, optionally assigning the existing workspace to it."""
import argparse
import getpass
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('account')
    parser.add_argument('--legacy', action='store_true', help='Bind the existing SGA_DATABASE_PATH workspace')
    parser.add_argument('--password-stdin', action='store_true', help='Read one password line from a private input pipe')
    args = parser.parse_args()
    password = sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('Password: ')

    from fastapi import HTTPException
    from sqlalchemy import inspect, select
    from sqlalchemy.orm import Session
    from app.database import engine
    from app.services.accounts import AccountStore, Account, account_name, verify_password
    from app.services.growth_data import create_sqlite_backup

    if args.legacy and not inspect(engine).has_table('workspace_metadata'):
        parser.error('Start the backend once to initialize the existing workspace.')
    store = AccountStore(engine)
    try:
        name = account_name(args.account)
        with Session(store.engine) as db:
            previous = db.scalar(select(Account).where(Account.account_key == name.casefold()))
            if previous:
                if not verify_password(password, previous.password_hash):
                    parser.error('The account exists with a different password.')
                if args.legacy and previous.workspace_key != 'legacy':
                    parser.error('This account already has a separate workspace.')
                print('Account already exists; workspace binding verified.')
                return
        if args.legacy:
            create_sqlite_backup(engine, force=True)
        user, token = store.register(name, password, legacy=args.legacy)
        store.logout(token)
        create_sqlite_backup(store.engine, force=True)
        print('Account created; ' + ('existing workspace bound.' if args.legacy else 'separate workspace initialized.'))
    except HTTPException as error:
        parser.error(error.detail.get('message', 'Unable to create account.'))
    finally:
        store.close()


if __name__ == '__main__':
    main()
