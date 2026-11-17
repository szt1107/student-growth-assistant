"""Register, sign in, inspect the session, and revoke the current session."""
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from ..services.accounts import COOKIE_NAME, SESSION_SECONDS

router = APIRouter(prefix='/api/auth', tags=['Accounts'])


class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account: str = Field(min_length=1, max_length=120)
    password: SecretStr


def sign_in(response, request, user, token):
    response.set_cookie(COOKIE_NAME, token, httponly=True,
        secure=request.url.scheme == 'https', samesite='lax', path='/api', max_age=SESSION_SECONDS)
    return {'user': user.public()}


@router.get('/session')
def session(request: Request):
    user = request.app.state.accounts.current(request.cookies.get(COOKIE_NAME))
    return {'required': request.app.state.auth_required, 'user': user.public() if user else None}


@router.post('/register', status_code=201)
def register(payload: Credentials, request: Request, response: Response):
    store = request.app.state.accounts
    store.guard_attempt('register', request.client.host if request.client else '')
    user, token = store.register(payload.account, payload.password.get_secret_value())
    return sign_in(response, request, user, token)


@router.post('/login')
def login(payload: Credentials, request: Request, response: Response):
    store = request.app.state.accounts
    store.guard_attempt('login', request.client.host if request.client else '')
    user, token = store.login(payload.account, payload.password.get_secret_value())
    return sign_in(response, request, user, token)


@router.post('/logout')
def logout(request: Request, response: Response):
    request.app.state.accounts.logout(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, path='/api', httponly=True, samesite='lax',
        secure=request.url.scheme == 'https')
    return {'status': 'signed_out'}
