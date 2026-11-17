"""Authenticate every HTTP/WebSocket API and bind one workspace per request."""
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse

from .services.accounts import COOKIE_NAME

ALLOWED_ORIGINS = tuple('http://' + host + ':' + str(port)
    for host in ('localhost', '127.0.0.1') for port in (5173, 5174, 5175, 5187))
PUBLIC_PATHS = frozenset(('/api/health', '/api/auth/session', '/api/auth/register',
    '/api/auth/login', '/api/auth/logout'))


class AccountMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] not in ('http', 'websocket') or not scope['path'].startswith('/api/'):
            return await self.app(scope, receive, send)
        connection = HTTPConnection(scope)
        if not connection.app.state.auth_required:
            return await self.app(scope, receive, send)
        try:
            origin = connection.headers.get('origin')
            mutating = scope['type'] == 'websocket' or scope.get('method') in ('POST', 'PUT', 'PATCH', 'DELETE')
            own_origin = str(connection.base_url).rstrip('/')
            if mutating and (origin and origin not in (*ALLOWED_ORIGINS, own_origin)
                    or connection.headers.get('sec-fetch-site') == 'cross-site'):
                raise HTTPException(403, detail={'code': 'ORIGIN_REJECTED', 'message': '请求来源无效，请从本站操作。'})
            if scope['path'] not in PUBLIC_PATHS and scope.get('method') != 'OPTIONS':
                store = connection.app.state.accounts
                user = await run_in_threadpool(store.current, connection.cookies.get(COOKIE_NAME))
                if user is None:
                    raise HTTPException(401, detail={'code': 'AUTH_REQUIRED', 'message': '请先登录。'})
                expected = connection.headers.get('x-account-id')
                if expected and expected != user.id:
                    raise HTTPException(409, detail={'code': 'ACCOUNT_CHANGED', 'message': '浏览器中的账号已变化，请重新进入工作区。'})
                scope.setdefault('state', {}).update(account=user,
                    workspace_engine=await run_in_threadpool(store.workspace_engine, user))
        except HTTPException as error:
            if scope['type'] == 'websocket':
                return await send({'type': 'websocket.close', 'code': 1008})
            return await JSONResponse({'detail': error.detail}, status_code=error.status_code)(scope, receive, send)
        async def private_response(message):
            if message['type'] == 'http.response.start':
                message['headers'] = [*message.get('headers', []), (b'cache-control', b'no-store')]
            await send(message)

        await self.app(scope, receive, private_response)
