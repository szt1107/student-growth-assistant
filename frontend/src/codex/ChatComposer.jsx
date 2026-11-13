import VoiceWave from './VoiceWave.jsx'
import { Button, Textarea } from './ui/controls.js'
// Layout adapted from assistant-ui's MIT-licensed ChatGPT example.
// Source revision and full upstream copy: codex/upstream/assistant-ui/.
import { useLayoutEffect, useRef } from 'react'
import { handleComposerKeyDown } from './composerKeyboard.js'
import { useDictation } from './useDictation.js'
import ComposerModes from './ComposerModes.jsx'

export default function ChatComposer({ value, onChange, onSubmit, disabled = false, sendDisabled = false, running = false, active = true, onStop, label = '会话输入', placeholder = '向成长助手提问，或描述你想安排的事…', maxLength, tools, mode = null, onModeChange }) {
  const input = useRef(null), composing = useRef(false)
  const voice = useDictation({ value, onText: text => onChange({ target: { value: text } }), enabled: active && !disabled && !running, maxLength })
  const canSend = active && !disabled && !sendDisabled && !running && !voice.listening && Boolean(value.trim())
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(180, Math.max(28, element.scrollHeight))}px`
  }, [value])
  return <form className="aui-composer" onSubmit={event => {
    if (!canSend || composing.current) { event.preventDefault(); return }
    onSubmit(event)
  }} aria-label="消息输入区">
    <Textarea className="rounded-none border-0 bg-transparent px-1 py-0" ref={input} rows={1} aria-label={label} value={value} onChange={onChange} disabled={disabled} readOnly={voice.listening} maxLength={maxLength} placeholder={placeholder}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onKeyDown={event => handleComposerKeyDown(event, { canSend, composing: composing.current })}/>
    <div className={voice.listening ? "aui-composer-toolbar aui-composer-toolbar-recording" : "aui-composer-toolbar"}>
      <div className="aui-composer-tools">{onModeChange&&<ComposerModes selected={mode} onChange={onModeChange} disabled={!active||disabled||running||voice.listening} inputRef={input}/>}{tools}{!voice.listening&&voice.message&&!['识别结束，请检查文字后发送。','已取消录音。'].includes(voice.message)&&<span className="aui-voice-status" role="status">{voice.message}</span>}</div>
      {voice.listening&&<VoiceWave analyser={voice.analyser} phase={voice.phase}/>}
      <div className="aui-composer-actions">
        <Button className="aui-mic rounded-full max-lg:size-11 [&_svg]:size-5" size="icon" type="button" onClick={voice.toggle} disabled={!active||disabled||running} aria-pressed={voice.listening} aria-label={voice.listening?'结束语音输入':'语音输入'} title={voice.listening?'结束语音输入':'语音输入'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6"/></svg></Button>
        {running && onStop ? <Button className="aui-send rounded-full max-lg:size-11 [&_svg]:size-5" size="icon" type="button" onClick={onStop} disabled={disabled} aria-label="停止生成" title="停止生成"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg></Button> :
          <Button className="aui-send rounded-full max-lg:size-11 [&_svg]:size-5" size="icon" type="submit" disabled={!canSend} aria-label="发送" title="发送消息"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></Button>}
      </div>
    </div>
  </form>
}
