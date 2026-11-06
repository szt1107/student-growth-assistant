"""Speech API contract tests; provider traffic always uses MockTransport."""
import base64
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.codex import speech


@pytest.fixture
def speech_client(monkeypatch):
    for key in ('QWEN_ASR_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_ASR_BASE_URL',
                'QWEN_ASR_MODEL', 'QWEN_ASR_TIMEOUT_SECONDS'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('QWEN_ASR_API_KEY', 'test-speech-secret')
    calls = []
    reply = {'status': 200, 'json': {'choices': [{'finish_reason': 'stop',
        'message': {'content': '明天下午3点写报告。'}}], 'id': 'test-request'}}

    def handle(request):
        calls.append(request)
        if 'exception' in reply:
            raise reply['exception']
        if 'content' in reply:
            return httpx.Response(reply['status'], content=reply['content'])
        return httpx.Response(reply['status'], json=reply['json'])

    monkeypatch.setattr(speech, 'create_http_client', lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(handle)))
    app = FastAPI(lifespan=speech.speech_lifespan)
    app.include_router(speech.router)
    with TestClient(app) as client:
        yield client, calls, reply
        pool = app.state.speech_client
    if pool is not None:
        assert pool.is_closed


def upload(client, audio=b'\x1aE\xdf\xa3test-audio', content_type='audio/webm;codecs=opus', query=''):
    return client.post('/api/speech/transcriptions'+query, content=audio,
                       headers={'Content-Type': content_type})


def test_status_exposes_capabilities_without_key_or_endpoint(speech_client):
    client, calls, _ = speech_client
    response = client.get('/api/speech/config')
    assert response.status_code == 200
    assert response.json()['configured'] is True
    assert response.json()['max_upload_bytes'] == speech.MAX_AUDIO_BYTES
    assert 'test-speech-secret' not in response.text
    assert 'base_url' not in response.json()
    assert calls == []


def test_provider_contract_returns_only_transcript_and_normalizes_mime(speech_client):
    client, calls, _ = speech_client
    audio = b'\x1aE\xdf\xa3test-audio'
    response = upload(client, audio, query='?language=zh')
    assert response.status_code == 200
    assert response.json()['text'] == '明天下午3点写报告。'
    assert response.json()['model'] == 'qwen3-asr-flash'
    assert len(calls) == 1
    request = calls[0]
    assert str(request.url) == 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    assert request.headers['authorization'] == 'Bearer test-speech-secret'
    payload = json.loads(request.content)
    assert payload['stream'] is False
    assert payload['asr_options'] == {'language': 'zh', 'enable_itn': True}
    assert payload['messages'] == [{'role': 'user', 'content': [{'type': 'input_audio',
        'input_audio': {'data': 'data:audio/webm;base64,'+base64.b64encode(audio).decode()}}]}]
    assert 'test-speech-secret' not in response.text


def test_auto_language_not_forced_and_itn_can_be_disabled(speech_client):
    client, calls, _ = speech_client
    assert upload(client, query='?enable_itn=false').status_code == 200
    assert json.loads(calls[0].content)['asr_options'] == {'enable_itn': False}


def test_missing_key_returns_actionable_error_without_call(speech_client, monkeypatch):
    client, calls, _ = speech_client
    monkeypatch.delenv('QWEN_ASR_API_KEY')
    assert client.get('/api/speech/config').json()['configured'] is False
    response = upload(client)
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'SPEECH_NOT_CONFIGURED'
    assert calls == []


def test_dashscope_key_and_workspace_endpoint(speech_client, monkeypatch):
    client, calls, _ = speech_client
    monkeypatch.delenv('QWEN_ASR_API_KEY')
    monkeypatch.setenv('DASHSCOPE_API_KEY', 'test-dashscope-key')
    monkeypatch.setenv('QWEN_ASR_BASE_URL', 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/')
    assert upload(client).status_code == 200
    assert calls[0].url.host == 'test-workspace.cn-beijing.maas.aliyuncs.com'


@pytest.mark.parametrize('mime,audio,status,code', [
    ('audio/webm', b'', 422, 'SPEECH_AUDIO_EMPTY'),
    ('application/json', b'{"audio":"x"}', 415, 'SPEECH_FORMAT_UNSUPPORTED'),
    ('audio/mp4', b'test', 415, 'SPEECH_FORMAT_UNSUPPORTED'),
    ('audio/webm', b'x' * (7_000_000+1), 413, 'SPEECH_AUDIO_TOO_LARGE'),
], ids=['empty', 'json-not-audio', 'unsupported-mp4', 'oversize'])
def test_invalid_upload_rejected_before_provider(speech_client, mime, audio, status, code):
    client, calls, _ = speech_client
    response = upload(client, audio, mime)
    assert response.status_code == status
    assert response.json()['detail']['code'] == code
    assert calls == []


def test_unknown_language_rejected(speech_client):
    client, calls, _ = speech_client
    assert upload(client, query='?language=made-up').status_code == 422
    assert calls == []


@pytest.mark.parametrize('status,expected,code', [
    (401, 503, 'SPEECH_AUTH_FAILED'), (403, 503, 'SPEECH_AUTH_FAILED'),
    (429, 429, 'SPEECH_RATE_LIMITED'), (400, 422, 'SPEECH_AUDIO_REJECTED'),
    (413, 422, 'SPEECH_AUDIO_REJECTED'), (500, 503, 'SPEECH_UNAVAILABLE'),
    (302, 503, 'SPEECH_UNAVAILABLE'),
])
def test_provider_errors_are_localized_and_redacted(speech_client, status, expected, code):
    client, calls, reply = speech_client
    reply.update(status=status, json={'message': 'test-speech-secret private-audio'})
    response = upload(client)
    assert response.status_code == expected
    assert response.json()['detail']['code'] == code
    assert 'test-speech-secret' not in response.text
    assert 'private-audio' not in response.text
    assert len(calls) == 1  # never retry a paid transcription automatically


@pytest.mark.parametrize('exception,expected,code', [
    (httpx.ReadTimeout('secret'), 504, 'SPEECH_TIMEOUT'),
    (httpx.ConnectError('secret'), 503, 'SPEECH_UNAVAILABLE'),
])
def test_network_failure(speech_client, exception, expected, code):
    client, _, reply = speech_client
    reply['exception'] = exception
    response = upload(client)
    assert response.status_code == expected
    assert response.json()['detail']['code'] == code
    assert 'secret' not in response.text


@pytest.mark.parametrize('payload', [None, {}, {'choices': []},
    {'choices': [{'message': {'content': ['invalid']}}]},
    {'choices': [{'finish_reason': 'length', 'message': {'content': '部分文字'}}]},
])
def test_invalid_provider_response(speech_client, payload):
    client, _, reply = speech_client
    reply['json'] = payload
    response = upload(client)
    assert response.status_code == 502
    assert response.json()['detail']['code'] == 'SPEECH_RESPONSE_INVALID'


def test_silence_is_not_invented_as_text(speech_client):
    client, _, reply = speech_client
    reply['json'] = {'choices': [{'finish_reason': 'stop', 'message': {'content': '  '}}]}
    response = upload(client)
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'SPEECH_NO_SPEECH'


@pytest.mark.parametrize('key,value', [
    ('QWEN_ASR_BASE_URL','http://dashscope.aliyuncs.com/compatible-mode/v1'),
    ('QWEN_ASR_BASE_URL','https://example.com/compatible-mode/v1'),
    ('QWEN_ASR_BASE_URL','https://user:secret@dashscope.aliyuncs.com/compatible-mode/v1'),
    ('QWEN_ASR_BASE_URL','https://dashscope.aliyuncs.com/compatible-mode/v1?key=secret'),
    ('QWEN_ASR_TIMEOUT_SECONDS','nan'), ('QWEN_ASR_TIMEOUT_SECONDS','0'),
    ('QWEN_ASR_MODEL','qwen3-asr-flash-realtime'),
    ('QWEN_ASR_API_KEY','not\r\na-key'),
])
def test_invalid_configuration_does_not_send_key(speech_client, monkeypatch, key, value):
    client, calls, _ = speech_client
    monkeypatch.setenv(key, value)
    assert client.get('/api/speech/config').json()['configured'] is False
    assert upload(client).status_code == 503
    assert calls == []


def test_registered_in_actual_application(client, monkeypatch):
    monkeypatch.delenv('QWEN_ASR_API_KEY', raising=False)
    monkeypatch.delenv('DASHSCOPE_API_KEY', raising=False)
    assert client.get('/api/speech/config').status_code == 200
    response = upload(client)
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'SPEECH_NOT_CONFIGURED'


@pytest.mark.parametrize('content', [b'not-json', b'x' * (1_000_000+1)], ids=['invalid-json','oversize-response'])
def test_malformed_or_oversize_response(speech_client, content):
    client, _, reply = speech_client
    reply['content'] = content
    assert upload(client).json()['detail']['code'] == 'SPEECH_RESPONSE_INVALID'


def test_chunked_upload_limit_does_not_depend_on_content_length():
    class ChunkedRequest:
        async def stream(self):
            yield b'x' * speech.MAX_AUDIO_BYTES
            yield b'x'
    with pytest.raises(speech.HTTPException) as error:
        asyncio.run(speech.read_audio(ChunkedRequest()))
    assert error.value.status_code == 413


def test_busy_capacity_rejects_before_reading_or_calling_provider(speech_client):
    client, calls, _ = speech_client
    semaphore = client.app.state.speech_slots
    client.portal.call(semaphore.acquire)
    client.portal.call(semaphore.acquire)
    try:
        response = upload(client)
        assert response.status_code == 429
        assert calls == []
    finally:
        client.portal.call(semaphore.release)
        client.portal.call(semaphore.release)
    assert upload(client).status_code == 200


def test_provider_error_releases_capacity(speech_client):
    client, _, reply = speech_client
    reply['status'] = 500
    for _ in range(3):
        assert upload(client).status_code == 503
    reply['status'] = 200
    assert upload(client).status_code == 200


def test_http_pool_closes_with_application(speech_client):
    client, _, _ = speech_client
    assert client.app.state.speech_client is None
    assert upload(client).status_code == 200
    pool = client.app.state.speech_client
    assert not pool.is_closed
    # The fixture's context manager asserts closure after the test completes.
