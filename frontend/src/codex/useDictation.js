import { useEffect, useRef, useState } from 'react'
import { speechRealtimeUrl } from '../api.js'

export function useDictation({ value, onText, enabled, maxLength }) {
  const [listening, setListening] = useState(false), [message, setMessage] = useState('')
  const [phase, setPhase] = useState('connecting')
  const analyser = useRef(null)
  const session = useRef(null), latest = useRef(null)
  latest.current = { value, onText, maxLength }
  function release(s) {
    clearTimeout(s.timer); clearTimeout(s.flushTimer)
    s.stream?.getTracks().forEach(t => t.stop())
    s.node?.disconnect(); s.source?.disconnect(); s.analyser?.disconnect()
    if (analyser.current === s.analyser) analyser.current = null
    s.context?.close().catch(() => {})
  }
  function cancel() {
    const s = session.current; session.current = null
    if (s) { clearTimeout(s.finishTimer); release(s); s.socket?.close() }
  }
  function finish() {
    const s = session.current
    if (!s || s.finishing) return
    if (!s.ready) { cancel(); setListening(false); setMessage('已取消录音。'); return }
    s.finishing = true; setPhase('finishing')
    s.endAudio = () => {
      if (session.current !== s || s.finishSent) return
      s.finishSent = true
      release(s)
      if (s.socket.readyState === WebSocket.OPEN) s.socket.send(JSON.stringify({ type: 'finish' }))
      else { cancel(); setListening(false); setMessage('连接已断开，已显示文字保留。') }
    }
    // A suspended audio thread may never acknowledge flush. Never trap the user.
    s.flushTimer = setTimeout(s.endAudio, 250)
    s.node.port.postMessage('flush')
    setMessage('正在确认最后一段文字…')
    s.finishTimer = setTimeout(() => { if (session.current === s) { cancel(); setListening(false); setMessage('最后一段确认超时，已显示文字保留，请检查。') } }, 22000)
  }
  useEffect(() => () => cancel(), [])
  useEffect(() => { if (!enabled) { cancel(); setListening(false); setMessage('') } }, [enabled])
  async function toggle() {
    if (!enabled) return
    if (session.current) { finish(); return }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) { setMessage('浏览器无法录音，请通过 localhost 或 HTTPS 使用新版浏览器。'); return }
    const s = { base: latest.current.value, items: new Map() }; session.current = s
    setPhase('connecting'); setListening(true); setMessage('')
    const fail = text => { if (session.current === s) { cancel(); setListening(false); setMessage(text) } }
    try {
      s.context = new AudioContext(); await s.context.resume()
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } })
      if (session.current !== s) { release(s); return }
      await s.context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url))
      if (session.current !== s) { release(s); return }
      s.socket = new WebSocket(speechRealtimeUrl())
      s.timer = setTimeout(() => fail('实时语音连接超时，请重试。'), 20000)
      s.socket.onmessage = event => {
        if (session.current !== s) return
        let data
        try { data = JSON.parse(event.data) } catch { fail('实时服务返回异常，现有文字保留，请重试。'); return }
        if (data.type === 'ready') {
          clearTimeout(s.timer); clearTimeout(s.flushTimer); s.ready = true
          s.source = s.context.createMediaStreamSource(s.stream)
          s.node = new AudioWorkletNode(s.context, 'pcm-input')
          s.node.port.onmessage = event => {
            if (session.current !== s || s.finishSent) return
            if (event.data === 'flushed') {
              s.endAudio?.(); return
            }
            if (s.socket.bufferedAmount > 128000) { fail('网络发送缓慢，实时录音已停止，现有文字保留。'); return }
            if (s.socket.readyState === WebSocket.OPEN) s.socket.send(event.data)
          }
          s.node.onprocessorerror = () => fail('音频处理已中断，现有文字保留，请重新开始录音。')
          s.stream.getAudioTracks().forEach(track => {
            track.onended = () => { if (!s.finishing) fail('麦克风连接已中断，现有文字保留，请检查设备后重试。') }
          })
          s.analyser = s.context.createAnalyser(); s.analyser.fftSize = 512
          analyser.current = s.analyser
          s.source.connect(s.analyser); s.analyser.connect(s.node); s.node.connect(s.context.destination)
          setPhase('recording')
          setMessage('正在实时识别，再次点击麦克风结束。')
          s.timer = setTimeout(finish, 290000)
        } else if (data.type === 'partial' || data.type === 'final') {
          s.items.set(data.item_id, data.text)
          const text = s.base + (s.base && !/\s$/.test(s.base) ? ' ' : '') + [...s.items.values()].join('')
          latest.current.onText(latest.current.maxLength ? text.slice(0, latest.current.maxLength) : text)
          if (latest.current.maxLength && text.length >= latest.current.maxLength) finish()
        } else if (data.type === 'done') {
          cancel(); setListening(false); setMessage('识别结束，请检查文字后发送。')
        } else if (data.type === 'error') fail(data.message)
      }
      s.socket.onerror = () => fail('实时语音连接失败，请检查网络和后端。')
      s.socket.onclose = () => fail('实时连接已断开，已显示的文字保留，请检查后发送。')
    } catch (error) {
      if (session.current !== s) { release(s); return }
      fail(error.name === 'NotAllowedError' ? '未获得麦克风权限，请允许后重试。' : '无法启动实时录音，请检查麦克风后重试。')
    }
  }
  function discard() {
    const base = session.current?.base
    cancel(); setListening(false); setMessage('')
    if (base !== undefined) latest.current.onText(base)
  }
  return { listening, message, toggle, analyser, phase, discard }
}
