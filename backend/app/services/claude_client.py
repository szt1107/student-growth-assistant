"""Anthropic Messages and OpenAI Chat Completions-compatible client.

The existing Claude symbols/env names are retained for configuration compatibility.
No database or planning access.
"""

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from . import ai_diagnostics as trace


TIMEOUT_SECONDS = 120.0
MAX_RETRIES = 3
RETRY_DELAYS = (1.0, 2.0, 4.0)
retry_observer = ContextVar('ai_retry_observer', default=None)
_shared_client = None


@asynccontextmanager
async def ai_client_session():
    """Own a lazy connection pool for one app lifecycle and event loop."""
    global _shared_client
    previous = _shared_client
    state = [asyncio.get_running_loop(), None]
    _shared_client = state
    try:
        yield
    finally:
        _shared_client = previous
        if state[1] is not None:
            await state[1].aclose()


@asynccontextmanager
async def _transport():
    state = _shared_client
    if state is not None and state[0] is asyncio.get_running_loop():
        if state[1] is None or state[1].is_closed:
            state[1] = httpx.AsyncClient(timeout=TIMEOUT_SECONDS,
                limits=httpx.Limits(max_connections=16, max_keepalive_connections=8, keepalive_expiry=60))
        yield state[1]
    else:
        # CLI/test loops never reuse sockets owned by another event loop.
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            yield client


class AIServiceError(Exception):
    """Only these fixed public messages may reach the API response."""

    def __init__(self, code: str, *, retryable=False, retry_after=None):
        self.code = code
        self.retryable = retryable
        self.retry_after = retry_after
        self.status_code, self.message = {
            "AI_NOT_CONFIGURED": (503, "AI parsing is not configured."),
            "AI_SKILLS_UNAVAILABLE": (503, "Assistant skills could not be loaded safely; no new action was executed."),
            "AI_CONTEXT_TOO_LARGE": (422, "Selected context exceeds the safe request limit; narrow the question or open the workspace."),
            "AI_UNAVAILABLE": (503, "The AI parsing service is temporarily unavailable."),
            "AI_RATE_LIMITED": (429, "The AI service is currently rate limited. Please retry later."),
            "AI_RESPONSE_INVALID": (502, "The AI parsing service returned an invalid response."),
        }[code]
        super().__init__(self.message)


def _network_error(exc):
    response = getattr(exc, 'response', None)
    status = response.status_code if response is not None else None
    retry_after = None
    if response is not None:
        try:retry_after = max(0.0, min(15.0, float(response.headers.get('retry-after', ''))))
        except ValueError:pass
    return AIServiceError('AI_RATE_LIMITED' if status == 429 else 'AI_UNAVAILABLE',
        retryable=status in (408, 425, 429, 500, 502, 503, 504) or isinstance(exc,
            (httpx.NetworkError, httpx.TimeoutException, httpx.RemoteProtocolError, httpx.ProxyError, TimeoutError)),
        retry_after=retry_after)


async def _wait_for_retry(error, retry):
    if not error.retryable or retry > MAX_RETRIES:raise error
    delay = error.retry_after if error.retry_after is not None else RETRY_DELAYS[retry - 1]
    trace.record('provider.retry',retry=retry,limit=MAX_RETRIES,delay_seconds=delay,code=error.code)
    observer = retry_observer.get()
    if observer is not None:observer({'attempt':retry,'limit':MAX_RETRIES,'reason':error.code})
    await asyncio.sleep(delay)


def _clear_retry():
    observer = retry_observer.get()
    if observer is not None:observer(False)


def _request_timeout():
    value=os.getenv('AI_TIMEOUT_SECONDS','').strip()
    if not value:return TIMEOUT_SECONDS
    try:seconds=float(value)
    except ValueError:raise AIServiceError('AI_NOT_CONFIGURED') from None
    if not 1<=seconds<=120:raise AIServiceError('AI_NOT_CONFIGURED')
    return seconds


@dataclass(frozen=True)
class ClaudeConfig:
    api_key: str = field(repr=False)
    model: str
    base_url: str = "https://newapi.iomgaa.online"
    api_version: str = "2023-06-01"
    api_format: str = "anthropic"
    thinking_effort: str | None = None


def get_claude_config() -> ClaudeConfig:
    # Optional and lazy: missing AI settings never prevent FastAPI startup.
    # Process environment takes precedence over the backend-local .env file.
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    api_format = os.getenv("AI_API_FORMAT", "anthropic").strip().lower()
    if api_format not in ("anthropic", "openai"):
        raise AIServiceError("AI_NOT_CONFIGURED")
    prefix = "OPENAI" if api_format == "openai" else "CLAUDE"
    key = os.getenv(f"{prefix}_API_KEY", "").strip()
    model = os.getenv(f"{prefix}_MODEL", "").strip()
    if not key or not model:
        raise AIServiceError("AI_NOT_CONFIGURED")
    default_base = "https://api.openai.com/v1" if api_format == "openai" else "https://newapi.iomgaa.online"
    base_url = os.getenv(f"{prefix}_BASE_URL", "").strip() or default_base
    try:
        official_deepseek = urlsplit(base_url).hostname == "api.deepseek.com"
    except ValueError:
        raise AIServiceError("AI_NOT_CONFIGURED") from None
    effort = os.getenv("AI_THINKING_EFFORT", "").strip().lower() or None
    if effort is None and api_format == "openai" and official_deepseek:
        effort = "low"
    if effort not in (None, "none", "low", "high", "max"):
        raise AIServiceError("AI_NOT_CONFIGURED")
    return ClaudeConfig(
        api_key=key,
        model=model,
        base_url=base_url,
        api_version=os.getenv("CLAUDE_API_VERSION", "").strip() or "2023-06-01",
        api_format=api_format,
        thinking_effort=effort,
    )


def extract_text(body: object) -> str:
    if not isinstance(body, dict) or not isinstance(body.get("content"), list):
        raise AIServiceError("AI_RESPONSE_INVALID")
    parts = []
    for block in body["content"]:
        if not isinstance(block, dict):
            raise AIServiceError("AI_RESPONSE_INVALID")
        if block.get("type") == "text":
            if not isinstance(block.get("text"), str):
                raise AIServiceError("AI_RESPONSE_INVALID")
            parts.append(block["text"])
    text = "".join(parts).strip()
    if not text:
        raise AIServiceError("AI_RESPONSE_INVALID")
    return text


def extract_openai_text(body: object) -> str:
    if not isinstance(body, dict) or not isinstance(body.get("choices"), list) or not body["choices"]:
        raise AIServiceError("AI_RESPONSE_INVALID")
    choice = body["choices"][0]
    if not isinstance(choice, dict) or choice.get("finish_reason") != "stop":
        raise AIServiceError("AI_RESPONSE_INVALID")
    message = choice.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str) or not message["content"].strip():
        raise AIServiceError("AI_RESPONSE_INVALID")
    # Only the final answer enters parsers/UI; reasoning_content is not a task action.
    return message["content"].strip()


def _wire(text, system, config, max_tokens):
    # Accept a gateway origin or its /v1 API base without duplicating the version.
    base_url = config.base_url.rstrip("/").removesuffix("/v1")
    if config.api_format == "openai":
        endpoint = f"{base_url}/v1/chat/completions"
        headers = {"authorization": f"Bearer {config.api_key}", "content-type": "application/json"}
        payload = {"model": config.model, "max_tokens": max_tokens,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}]}
        if urlsplit(base_url).hostname == "api.deepseek.com":
            enabled = config.thinking_effort != "none"
            payload["thinking"] = {"type": "enabled" if enabled else "disabled"}
            if enabled:
                payload["reasoning_effort"] = config.thinking_effort or "low"
                # DeepSeek's output budget also covers reasoning before the final JSON.
                payload["max_tokens"] = max(max_tokens, 8192)
        elif config.model.lower()=='glm-5' or config.model.lower().startswith(('glm-5.','glm-5-')):
            # GLM-5 gateways otherwise spend the small answer budget on hidden
            # reasoning and terminate with length before emitting any answer.
            enabled=config.thinking_effort not in (None,'none')
            payload['thinking']={'type':'enabled' if enabled else 'disabled'}
            if enabled:
                payload['reasoning_effort']=config.thinking_effort
                payload['max_tokens']=max(max_tokens,8192)
        elif config.thinking_effort is not None:
            payload["reasoning_effort"] = config.thinking_effort
    else:
        endpoint = f"{base_url}/v1/messages"
        headers = {"x-api-key": config.api_key, "anthropic-version": config.api_version,
                   "content-type": "application/json"}
        payload = {"model": config.model, "max_tokens": max_tokens, "system": system,
                   "messages": [{"role": "user", "content": text}]}
    return endpoint, headers, payload


async def request_claude(text: str, system: str, config: ClaudeConfig, max_tokens: int = 600, *, json_mode: bool = False) -> str:
    """Retry transient transport failures within the existing total deadline."""
    try:
        async with asyncio.timeout(_request_timeout()):
            for attempt in range(MAX_RETRIES + 1):
                try:
                    return await _request_claude_once(text, system, config, max_tokens, json_mode=json_mode)
                except AIServiceError as exc:
                    await _wait_for_retry(exc, attempt + 1)
    except TimeoutError:
        raise AIServiceError('AI_UNAVAILABLE') from None
    finally:
        _clear_retry()


async def _request_claude_once(text, system, config, max_tokens, *, json_mode=False):
    trace.record('provider.request',protocol=config.api_format,stream=False,max_tokens=max_tokens)
    timeout_seconds=_request_timeout()
    try:
        endpoint, headers, payload = _wire(text, system, config, max_tokens)
        # Only advertise this capability for documented official endpoints;
        # compatible gateways may reject response_format.
        if json_mode and config.api_format == 'openai' and urlsplit(config.base_url).hostname in ('api.deepseek.com', 'api.openai.com'):
            payload['response_format'] = {'type': 'json_object'}
        trace.record('provider.budget',max_tokens=payload['max_tokens'])
        # Both per-operation and total request deadlines are bounded.
        async with asyncio.timeout(timeout_seconds):
            async with _transport() as client:
                response = await client.post(
                    endpoint,
                    headers=headers,
                    json=payload,
                    timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 10.0)),
                )
                response.raise_for_status()
                trace.record('provider.http',status=response.status_code,stream=False)
    except (httpx.HTTPError, httpx.InvalidURL, TimeoutError, ValueError) as exc:
        status = getattr(getattr(exc,'response',None),'status_code',None)
        trace.record('provider.network_failed',status=status,error_type=type(exc).__name__)
        # Do not expose provider errors, headers, request text, or secrets.
        raise _network_error(exc) from None
    try:
        body = response.json()
    except (ValueError, RecursionError) as exc:
        trace.record('provider.body_invalid',error_type=type(exc).__name__)
        raise AIServiceError("AI_RESPONSE_INVALID") from None
    reason=(body.get('choices') or [{}])[0].get('finish_reason') if config.api_format=='openai' and isinstance(body,dict) and isinstance(body.get('choices'),list) and body['choices'] and isinstance(body['choices'][0],dict) else body.get('stop_reason') if isinstance(body,dict) else None
    trace.record('provider.body',structure=type(body).__name__,finish_reason=reason if reason in ('stop','length','tool_calls','content_filter','end_turn','stop_sequence','max_tokens','tool_use',None) else 'unknown')
    if config.api_format == "openai":
        return extract_openai_text(body)
    if isinstance(body,dict) and body.get('stop_reason')=='max_tokens':
        raise AIServiceError('AI_RESPONSE_INVALID')
    return extract_text(body)


async def _sse_frames(response):
    """HTTP chunks/CRLF are handled by httpx; dispatch an EOF-terminated frame.

    EOF alone does not establish success: the consumer still requires a real
    provider finish reason. A network exception never dispatches a partial frame.
    """
    data=[];size=0
    async for line in response.aiter_lines():
        size+=len(line)
        if size>1024*1024:raise AIServiceError('AI_RESPONSE_INVALID')
        if line.startswith('data:'):data.append(line[5:].lstrip())
        if not line and data:
            yield '\n'.join(data);data=[]
    if data:yield '\n'.join(data)


async def stream_claude(text: str, system: str, config: ClaudeConfig, max_tokens: int = 2000):
    """Retry before answer text is received, preserving partial output on failure."""
    received = False
    try:
        async with asyncio.timeout(_request_timeout()):
            for attempt in range(MAX_RETRIES + 1):
                try:
                    async for event in _stream_claude_once(text, system, config, max_tokens):
                        if event['type'] == 'delta' and event.get('text'):received = True
                        yield event
                    return
                except AIServiceError as exc:
                    if received:raise
                    await _wait_for_retry(exc, attempt + 1)
    except TimeoutError:
        raise AIServiceError('AI_UNAVAILABLE') from None
    finally:
        _clear_retry()


async def _stream_claude_once(text, system, config, max_tokens):
    """Only final-answer deltas leave the transport; reasoning never reaches UI.

    A rejecting gateway is retried once without stream. A broken established
    stream is never silently reissued. Callers persist actual received text.
    """
    timeout = _request_timeout()
    trace.record('provider.request',protocol=config.api_format,stream=True,max_tokens=max_tokens)
    try:
        endpoint, headers, payload = _wire(text, system, config, max_tokens)
        trace.record('provider.budget',max_tokens=payload['max_tokens'])
        payload['stream'] = True
        fallback = False
        async with asyncio.timeout(timeout):
            async with _transport() as client:
                async with client.stream('POST', endpoint, headers=headers, json=payload, timeout=httpx.Timeout(timeout, connect=min(timeout, 10.0))) as response:
                    trace.record('provider.http',status=response.status_code,stream=True)
                    if response.status_code in (400, 404, 405, 415, 422, 501):
                        fallback = True
                    else:
                        response.raise_for_status()
                        if 'text/event-stream' not in response.headers.get('content-type', ''):
                            raw = await response.aread()
                            if len(raw) > 1024 * 1024:
                                raise AIServiceError('AI_RESPONSE_INVALID')
                            body = json.loads(raw)
                            answer = extract_openai_text(body) if config.api_format == 'openai' else extract_text(body)
                            if config.api_format != 'openai' and body.get('stop_reason') not in ('end_turn', 'stop_sequence'):
                                raise AIServiceError('AI_RESPONSE_INVALID')
                            yield {'type': 'mode', 'value': 'full'}
                            yield {'type': 'delta', 'text': answer}
                            return
                        yield {'type': 'mode', 'value': 'streaming'}
                        ended, valid_finish, output = False, False, 0
                        reason=None
                        async for raw in _sse_frames(response):
                            if raw == '[DONE]':
                                ended = True
                                break
                            event = json.loads(raw)
                            if not isinstance(event,dict):raise AIServiceError('AI_RESPONSE_INVALID')
                            part = ''
                            if config.api_format == 'openai':
                                choices = event.get('choices', [])
                                if not choices:
                                    continue  # optional usage event
                                choice = choices[0]
                                if choice.get('finish_reason') is not None:
                                    valid_finish = choice['finish_reason'] == 'stop'
                                    reason=choice['finish_reason']
                                part = choice.get('delta', {}).get('content') or ''
                            else:
                                if event.get('type') == 'error':
                                    kind = (event.get('error') or {}).get('type')
                                    raise AIServiceError('AI_RATE_LIMITED' if kind == 'rate_limit_error' else 'AI_UNAVAILABLE',
                                        retryable=kind in ('rate_limit_error','overloaded_error','api_error'))
                                if event.get('type') == 'content_block_delta' and event.get('delta', {}).get('type') == 'text_delta':
                                    part = event['delta'].get('text', '')
                                if event.get('type') == 'message_delta':
                                    reason=event.get('delta', {}).get('stop_reason')
                                    valid_finish = reason in ('end_turn', 'stop_sequence')
                                if event.get('type') == 'message_stop':
                                    ended = True
                                    break
                            if not isinstance(part, str):
                                raise AIServiceError('AI_RESPONSE_INVALID')
                            output += len(part)
                            if output > 16000:
                                raise AIServiceError('AI_RESPONSE_INVALID')
                            if part:
                                yield {'type': 'delta', 'text': part}
                        complete=valid_finish and bool(output) and (ended or config.api_format=='openai')
                        trace.record('provider.stream_end',terminal_seen=ended,normal_finish=valid_finish,complete=complete,
                            output_characters=output,finish_reason=reason if reason in ('stop','length','tool_calls','content_filter','end_turn','stop_sequence','max_tokens',None) else 'unknown')
                        if not complete:
                            raise AIServiceError('AI_RESPONSE_INVALID', retryable=not output and reason is None)
        if fallback:
            yield {'type': 'mode', 'value': 'full'}
            answer = await _request_claude_once(text, system, config, max_tokens)
            yield {'type': 'delta', 'text': answer}
    except AIServiceError:
        raise
    except (httpx.HTTPError, httpx.InvalidURL, TimeoutError) as exc:
        status = getattr(getattr(exc,'response',None),'status_code',None)
        trace.record('provider.stream_network_failed',status=status,error_type=type(exc).__name__)
        raise _network_error(exc) from None
    except (ValueError, TypeError, KeyError, IndexError, RecursionError,AttributeError) as exc:
        trace.record('provider.stream_parse_failed',error_type=type(exc).__name__)
        raise AIServiceError('AI_RESPONSE_INVALID') from None
