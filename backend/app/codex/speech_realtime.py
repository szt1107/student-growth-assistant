"""Streaming PCM relay; credentials never leave the backend."""
import asyncio
import base64
import json
import os
import re
from contextlib import suppress
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect
from .speech import router, get_config


def event(kind, **fields):
    return json.dumps({'event_id': uuid4().hex, 'type': kind, **fields})


@router.websocket('/realtime')
async def realtime(ws: WebSocket):
    origin = ws.headers.get('origin')
    if origin and origin not in ('http://127.0.0.1:5187', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5175', 'http://127.0.0.1:5175'):
        await ws.close(code=1008)
        return
    await ws.accept()
    tasks = []
    acquired = False
    try:
        config = get_config()
        model = os.getenv('QWEN_ASR_REALTIME_MODEL', 'qwen3-asr-flash-realtime')
        if not re.fullmatch(r'qwen3-asr-flash-realtime(?:-\d{4}-\d{2}-\d{2})?', model):
            raise ValueError('invalid config')
        host = urlsplit(config.base_url).hostname
        # Reuse the validated official region and key, with a separate realtime model.
        url = f'wss://{host}/api-ws/v1/realtime?model={model}'
        await asyncio.wait_for(ws.app.state.speech_slots.acquire(), .1)
        acquired = True
        async with connect(url, additional_headers={'Authorization': 'Bearer '+config.api_key},
                           open_timeout=15, close_timeout=3, max_size=1_000_000) as upstream:
            async with asyncio.timeout(310):
                await upstream.send(event('session.update', session={
                    'input_audio_format': 'pcm', 'sample_rate': 16000,
                    'input_audio_transcription': {},
                    'turn_detection': {'type': 'server_vad', 'threshold': .2, 'silence_duration_ms': 400}}))
                async def receive_audio():
                    total = 0
                    while True:
                        message = await asyncio.wait_for(ws.receive(), timeout=40)
                        if message['type'] == 'websocket.disconnect':
                            return
                        if message.get('bytes') is not None:
                            data = message['bytes']
                            total += len(data)
                            if not data or len(data) > 64000 or len(data) % 2 or total > 9_600_000:
                                raise ValueError('invalid audio')
                            await upstream.send(event('input_audio_buffer.append', audio=base64.b64encode(data).decode()))
                        elif message.get('text') == '{"type":"finish"}':
                            await upstream.send(event('session.finish'))
                            # Keep observing the browser during finalization. Closing
                            # a tab must release the slot immediately, not 20s later.
                            async with asyncio.timeout(20):
                                while True:
                                    message = await ws.receive()
                                    if message['type'] == 'websocket.disconnect':
                                        return
                        else:
                            raise ValueError('invalid message')
                async def receive_text():
                    async for raw in upstream:
                        data = json.loads(raw)
                        kind = data.get('type', '')
                        if kind == 'session.updated':
                            await ws.send_json({'type': 'ready'})
                        elif kind in ('conversation.item.input_audio_transcription.text', 'conversation.item.input_audio_transcription.completed'):
                            final = kind.endswith('.completed')
                            text = data.get('transcript', '') if final else data.get('text', '') + data.get('stash', '')
                            await ws.send_json({'type': 'final' if final else 'partial', 'item_id': data.get('item_id'), 'text': text})
                        elif kind == 'session.finished':
                            await ws.send_json({'type': 'done'})
                            return
                        elif kind == 'error' or kind.endswith('transcription.failed'):
                            raise RuntimeError('upstream failed')
                    raise RuntimeError('upstream closed')
                tasks = [asyncio.create_task(receive_audio()), asyncio.create_task(receive_text())]
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
    except asyncio.CancelledError:
        pass
    except (Exception, WebSocketDisconnect):
        with suppress(Exception):
            await ws.send_json({'type': 'error', 'message': '实时语音连接中断或配置不可用，已显示的文字保留，请检查网络与千问实时模型权限后重试。'})
    finally:
        for task in tasks:
            task.cancel()
        if acquired:
            ws.app.state.speech_slots.release()
        with suppress(asyncio.CancelledError):
            await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(Exception):
            await ws.close()
