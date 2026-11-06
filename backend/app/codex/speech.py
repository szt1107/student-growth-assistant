"""Qwen ASR adapter. Audio and transcripts are never stored or sent to chat."""
import asyncio
import base64
import json
import math
import os
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from starlette.requests import ClientDisconnect


# Base64 plus JSON stays below the provider's 10 MB request limit.
MAX_AUDIO_BYTES = 7_000_000
MAX_RESPONSE_BYTES = 1_000_000
MAX_AUDIO_SECONDS = 300
MIME_TYPES = ('audio/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg',
              'audio/opus', 'audio/flac', 'audio/aac', 'audio/amr')
MIME_ALIASES = {'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav',
                'audio/mp3': 'audio/mpeg', 'audio/x-flac': 'audio/flac'}
Language = Literal['zh', 'yue', 'en', 'ja', 'de', 'ko', 'ru', 'fr', 'pt',
    'ar', 'it', 'es', 'hi', 'id', 'th', 'tr', 'uk', 'vi', 'cs', 'da',
    'fil', 'fi', 'is', 'ms', 'no', 'pl', 'sv']
router = APIRouter(prefix='/api/speech', tags=['Speech input'])

ERRORS = {
    'SPEECH_NOT_CONFIGURED': (503, '语音识别尚未配置，请填写千问 API Key，并检查服务地址与模型设置。'),
    'SPEECH_AUDIO_EMPTY': (422, '录音为空，请重新录音。'),
    'SPEECH_FORMAT_UNSUPPORTED': (415, '不支持该音频格式，请使用 WebM、WAV、MP3、OGG、Opus、FLAC、AAC 或 AMR。'),
    'SPEECH_AUDIO_TOO_LARGE': (413, '录音过大，请缩短录音，单次最多上传 7000000 字节。'),
    'SPEECH_AUDIO_REJECTED': (422, '千问无法处理这段音频，请使用有效音频并确保不超过5分钟。'),
    'SPEECH_NO_SPEECH': (422, '未识别到语音，请靠近麦克风重新录音。'),
    'SPEECH_AUTH_FAILED': (503, '千问语音识别鉴权失败，请检查 API Key、地域和模型权限。'),
    'SPEECH_RATE_LIMITED': (429, '语音识别请求较多，请稍后重试。'),
    'SPEECH_TIMEOUT': (504, '语音识别超时，请缩短录音后重试。'),
    'SPEECH_UPLOAD_TIMEOUT': (408, '录音上传超时，请重新上传。'),
    'SPEECH_UNAVAILABLE': (503, '语音识别服务暂时不可用，请稍后重试。'),
    'SPEECH_RESPONSE_INVALID': (502, '语音识别服务返回了不完整或无法读取的结果，请重新识别。'),
}


def fail(code: str):
    status, message = ERRORS[code]
    raise HTTPException(status, detail={'code': code, 'message': message})


@dataclass(frozen=True)
class SpeechConfig:
    api_key: str = field(repr=False)
    base_url: str
    model: str
    timeout: float


def get_config() -> SpeechConfig:
    # Only backend environment variables; never reuse the chat provider key.
    key = (os.getenv('QWEN_ASR_API_KEY', '').strip()
           or os.getenv('DASHSCOPE_API_KEY', '').strip())
    base = os.getenv('QWEN_ASR_BASE_URL',
        'https://dashscope.aliyuncs.com/compatible-mode/v1').strip().rstrip('/')
    model = os.getenv('QWEN_ASR_MODEL', 'qwen3-asr-flash').strip()
    try:
        timeout = float(os.getenv('QWEN_ASR_TIMEOUT_SECONDS', '60'))
        url = urlsplit(base)
        host = url.hostname or ''
        official = host in ('dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com') or bool(
            re.fullmatch(r'[a-zA-Z0-9-]+\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com', host))
        valid = (key and key.isascii() and all(32 < ord(char) < 127 for char in key)
            and url.scheme == 'https' and official and url.port in (None, 443)
            and not url.username and not url.password and not url.query and not url.fragment
            and url.path == '/compatible-mode/v1'
            and re.fullmatch(r'qwen3-asr-flash(?:-\d{4}-\d{2}-\d{2})?', model)
            and math.isfinite(timeout) and 5 <= timeout <= 120)
    except (ValueError, TypeError):
        valid = False
    if not valid:
        fail('SPEECH_NOT_CONFIGURED')
    return SpeechConfig(key, base, model, timeout)


def create_http_client():
    return httpx.AsyncClient(timeout=60, follow_redirects=False,
        limits=httpx.Limits(max_connections=2, max_keepalive_connections=2))


@asynccontextmanager
async def speech_lifespan(app):
    # Pool and upload concurrency limit belong to this app's event loop.
    # Create sockets only when speech is used; ordinary chat startup stays cheap.
    app.state.speech_client = None
    app.state.speech_slots = asyncio.Semaphore(2)
    try:
        yield
    finally:
        if app.state.speech_client is not None:
            await app.state.speech_client.aclose()
        del app.state.speech_client
        del app.state.speech_slots


class SpeechStatus(BaseModel):
    configured: bool
    provider: str = 'qwen'
    model: str | None
    max_upload_bytes: int = MAX_AUDIO_BYTES
    max_audio_seconds: int = MAX_AUDIO_SECONDS
    mime_types: list[str] = list(MIME_TYPES)
    mode: str = 'record_then_transcribe'


class Transcript(BaseModel):
    text: str
    model: str


@router.get('/config', response_model=SpeechStatus)
def speech_status():
    try:
        config = get_config()
    except HTTPException:
        return SpeechStatus(configured=False, model=None)
    return SpeechStatus(configured=True, model=config.model)


async def read_audio(request: Request) -> bytes:
    audio = bytearray()
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
                    fail('SPEECH_AUDIO_TOO_LARGE')
                audio.extend(chunk)
    except TimeoutError:
        fail('SPEECH_UPLOAD_TIMEOUT')
    except ClientDisconnect:
        raise HTTPException(400, detail={'code': 'SPEECH_UPLOAD_INTERRUPTED',
            'message': '录音上传已中断，请重试。'}) from None
    if not audio:
        fail('SPEECH_AUDIO_EMPTY')
    return bytes(audio)


async def recognize(client, config: SpeechConfig, audio: bytes, mime: str,
                    language: str | None, enable_itn: bool) -> Transcript:
    options = {'enable_itn': enable_itn}
    if language:
        options['language'] = language
    payload = {'model': config.model, 'stream': False, 'asr_options': options,
        'messages': [{'role': 'user', 'content': [{'type': 'input_audio',
            'input_audio': {'data': f'data:{mime};base64,' + base64.b64encode(audio).decode('ascii')}}]}]}
    try:
        async with asyncio.timeout(config.timeout):
            async with client.stream('POST', config.base_url + '/chat/completions',
                    headers={'Authorization': 'Bearer ' + config.api_key},
                    json=payload, timeout=config.timeout) as response:
                if response.status_code in (401, 403):
                    fail('SPEECH_AUTH_FAILED')
                if response.status_code == 429:
                    fail('SPEECH_RATE_LIMITED')
                if response.status_code in (400, 413, 415, 422):
                    fail('SPEECH_AUDIO_REJECTED')
                if response.status_code != 200:
                    fail('SPEECH_UNAVAILABLE')
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                        fail('SPEECH_RESPONSE_INVALID')
                    data.extend(chunk)
    except (TimeoutError, httpx.TimeoutException):
        fail('SPEECH_TIMEOUT')
    except httpx.HTTPError:
        fail('SPEECH_UNAVAILABLE')
    try:
        result = json.loads(data)
        choice = result['choices'][0]
        text = choice['message']['content']
        if not isinstance(text, str) or choice.get('finish_reason') != 'stop':
            raise ValueError('invalid transcription')
    except (ValueError, TypeError, KeyError, IndexError):
        fail('SPEECH_RESPONSE_INVALID')
    if not text.strip():
        fail('SPEECH_NO_SPEECH')
    return Transcript(text=text.strip(), model=config.model)


@router.post('/transcriptions', response_model=Transcript,
    openapi_extra={'requestBody': {'required': True, 'content': {
        mime: {'schema': {'type': 'string', 'format': 'binary'}} for mime in MIME_TYPES}}})
async def transcribe(request: Request,
        language: Language | None = Query(default=None),
        enable_itn: bool = Query(default=True)):
    config = get_config()
    mime = request.headers.get('content-type', '').split(';', 1)[0].strip().lower()
    mime = MIME_ALIASES.get(mime, mime)
    if mime not in MIME_TYPES:
        fail('SPEECH_FORMAT_UNSUPPORTED')
    length = request.headers.get('content-length')
    if length:
        try:
            if int(length) > MAX_AUDIO_BYTES:
                fail('SPEECH_AUDIO_TOO_LARGE')
        except ValueError:
            raise HTTPException(400, detail={'code': 'SPEECH_UPLOAD_INVALID',
                'message': '录音请求长度无效。'}) from None
    semaphore = request.app.state.speech_slots
    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=0.1)
    except TimeoutError:
        fail('SPEECH_RATE_LIMITED')
    try:
        audio = await read_audio(request)
        if request.app.state.speech_client is None:
            request.app.state.speech_client = create_http_client()
        return await recognize(request.app.state.speech_client, config, audio, mime, language, enable_itn)
    finally:
        semaphore.release()
