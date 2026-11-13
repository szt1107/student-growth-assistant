import asyncio
import json
from contextlib import asynccontextmanager
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.codex import speech, speech_realtime

@pytest.fixture
def realtime_client(monkeypatch):
    monkeypatch.setenv('QWEN_ASR_API_KEY','test-key')
    monkeypatch.setenv('QWEN_ASR_BASE_URL','https://dashscope.aliyuncs.com/compatible-mode/v1')
    monkeypatch.setenv('QWEN_ASR_MODEL','qwen3-asr-flash')
    monkeypatch.delenv('QWEN_ASR_REALTIME_MODEL',raising=False)
    sent=[]
    class Upstream:
        def __init__(self): self.queue=asyncio.Queue()
        async def send(self,raw):
            event=json.loads(raw);sent.append(event)
            if event['type']=='session.update': await self.queue.put({'type':'session.updated'})
            if event['type']=='input_audio_buffer.append':
                await self.queue.put({'type':'conversation.item.input_audio_transcription.text','item_id':'one','text':'明天','stash':'下午'})
            if event['type']=='session.finish' and not getattr(app.state,'hold_final',False):
                await self.queue.put({'type':'conversation.item.input_audio_transcription.completed','item_id':'one','transcript':'明天下午。'})
                await self.queue.put({'type':'session.finished'})
        def __aiter__(self):return self
        async def __anext__(self):return json.dumps(await self.queue.get())
    @asynccontextmanager
    async def connect(url,**kwargs):
        assert url.endswith('model=qwen3-asr-flash-realtime')
        assert kwargs['additional_headers']['Authorization']=='Bearer test-key'
        yield Upstream()
    monkeypatch.setattr(speech_realtime,'connect',connect)
    app=FastAPI(lifespan=speech.speech_lifespan);app.include_router(speech.router)
    with TestClient(app) as client:yield client,sent

def test_partial_arrives_before_finish_and_final_replaces_preview(realtime_client):
    client,sent=realtime_client
    with client.websocket_connect('/api/speech/realtime') as socket:
        assert socket.receive_json()=={'type':'ready'}
        socket.send_bytes(b'\0\0'*1600)
        assert socket.receive_json()=={'type':'partial','item_id':'one','text':'明天下午'}
        assert not any(e['type']=='session.finish' for e in sent)
        socket.send_text('{"type":"finish"}')
        assert socket.receive_json()=={'type':'final','item_id':'one','text':'明天下午。'}
        assert socket.receive_json()=={'type':'done'}
    assert client.app.state.speech_slots._value==2

def test_bad_pcm_is_rejected_and_slot_released(realtime_client):
    client,_=realtime_client
    with client.websocket_connect('/api/speech/realtime') as socket:
        socket.receive_json();socket.send_bytes(b'x')
        response=socket.receive_json()
        assert response['type']=='error'
        assert 'test-key' not in str(response)
    assert client.app.state.speech_slots._value==2

def test_cross_origin_websocket_rejected(realtime_client):
    from starlette.websockets import WebSocketDisconnect
    client,_=realtime_client
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/api/speech/realtime',headers={'origin':'https://unknown.example'}):pass


def test_disconnect_while_waiting_for_final_releases_slot_immediately(realtime_client):
    import time
    client,sent=realtime_client
    client.app.state.hold_final=True
    for _ in range(3):
        with client.websocket_connect('/api/speech/realtime') as socket:
            assert socket.receive_json()=={'type':'ready'}
            socket.send_bytes(b'\0\0'*1600)
            socket.receive_json()
            before=sum(e['type']=='session.finish' for e in sent)
            socket.send_text('{"type":"finish"}')
            deadline=time.monotonic()+1
            while sum(e['type']=='session.finish' for e in sent)==before and time.monotonic()<deadline:
                time.sleep(.01)
            assert sum(e['type']=='session.finish' for e in sent)>before
        deadline=time.monotonic()+1
        while client.app.state.speech_slots._value!=2 and time.monotonic()<deadline:
            time.sleep(.01)
        assert client.app.state.speech_slots._value==2
