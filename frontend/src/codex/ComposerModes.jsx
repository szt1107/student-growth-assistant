import { useEffect, useRef, useState } from 'react'
import { Plus, X, Check } from 'lucide-react'
import { Button } from './ui/controls.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.jsx'

// Match the paths and stroke style of the main navigation exactly.
function ModeIcon({ page, ...props }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {page==='plan'?<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h4"/></>:
      page==='review'?<><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/><path d="M12 7v5l3 2"/></>:
      <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>}
  </svg>
}
const modes = [
  { key: 'plan', label: '计划' },
  { key: 'review', label: '复盘' },
  { key: 'profile', label: '档案' },
]

// Selection is sent as metadata; trusted instructions are owned by the server.
export default function ComposerModes({ disabled, inputRef, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const returnToInput = useRef(false)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const mode = modes.find(item => item.key === selected)
  return <div className="composer-modes">
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button className="composer-add rounded-full max-lg:size-11" variant="ghost" size="icon" type="button" disabled={disabled} aria-label="添加聊天模式" title="添加聊天模式"><Plus aria-hidden="true"/></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="composer-mode-menu rounded-2xl p-2" side="top" align="start" sideOffset={10} collisionPadding={12} aria-label="聊天模式" onCloseAutoFocus={event => {
        if (!returnToInput.current) return
        event.preventDefault(); returnToInput.current = false; inputRef.current?.focus()
      }}>
        <div className="composer-mode-heading">添加</div>
        {modes.map(({key,label})=><DropdownMenuItem className="composer-mode-item" key={key} onSelect={()=>{
          onChange(key); returnToInput.current = true
        }}><ModeIcon page={key} aria-hidden="true"/><span>{label}</span>{selected===key&&<Check className="composer-mode-check" aria-hidden="true"/>}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {mode&&<div className="composer-mode-chip" role="group" aria-label={`已选择${mode.label}模式`}>
      <ModeIcon page={mode.key} aria-hidden="true"/><span>{mode.label}</span>
      <Button variant="ghost" size="icon" className="composer-mode-clear size-6 min-h-6 rounded-full p-1" type="button" disabled={disabled} aria-label={`取消${mode.label}模式`} title="取消选择" onClick={()=>{onChange(null);inputRef.current?.focus()}}><X aria-hidden="true"/></Button>
    </div>}
  </div>
}
