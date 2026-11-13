import { useEffect, useRef } from 'react'
import './voice-wave.css'

export default function VoiceWave({ analyser, phase }) {
  const canvas = useRef(null)
  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d')
    let frame, lastTime = null, amplitude = 0, offset = 0, head = 0
    let width = 0, height = 32, ratio = 1, activeColor, idleColor
    const spacing = 5, sampleMs = 40, history = new Float32Array(4096)
    const samples = new Float32Array(512)
    function measure() {
      width = el.clientWidth; height = el.clientHeight
      ratio = window.devicePixelRatio || 1
      el.width = Math.round(width * ratio); el.height = Math.round(height * ratio)
      const colors = getComputedStyle(el.parentElement)
      activeColor = colors.color; idleColor = colors.borderTopColor
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el); measure()
    window.addEventListener('resize', measure)
    function draw(time) {
      const elapsed = lastTime === null ? 0 : Math.max(0, Math.min(50, time - lastTime))
      lastTime = time
      let target = 0
      if (phase === 'recording' && analyser.current) {
        analyser.current.getFloatTimeDomainData(samples)
        let energy = 0
        for (const value of samples) energy += value * value
        target = Math.min(1, Math.sqrt(energy / samples.length) * 6)
      }
      amplitude += (target - amplitude) * (1 - Math.exp(-elapsed / (target > amplitude ? 25 : 65)))
      // Sampling and motion are independent: move a fractional pixel on EVERY
      // display frame, even between successive audio-history samples.
      offset += elapsed * spacing / sampleMs
      while (offset >= spacing) {
        offset -= spacing
        head = (head + 1) % history.length
        history[head] = amplitude
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const count = Math.min(history.length, Math.ceil(width / spacing) + 2)
      for (let i = 0; i < count; i++) {
        const value = history[(head - i + history.length) % history.length]
        const bar = Math.max(2, value * 26)
        ctx.fillStyle = value > .03 ? activeColor : idleColor
        ctx.beginPath()
        ctx.roundRect(width - offset - i * spacing, (height - bar) / 2, 2.5, bar, 1.25)
        ctx.fill()
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [analyser, phase])
  return <div className="voice-wave" role="group" aria-label={phase === 'finishing' ? '正在结束语音输入' : phase === 'connecting' ? '正在连接语音输入' : '正在录音'} aria-busy={phase !== 'recording'}>
    <canvas ref={canvas} className="voice-wave-canvas" aria-hidden="true"/>

  </div>
}
