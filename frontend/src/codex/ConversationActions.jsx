import { useRef } from 'react'
import { Button } from './ui/controls.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.jsx'

export function ConversationRow({ row, selected, expanded, disabled, onOpen, onMenu, onClose, items = [] }) {
  const anchor = useRef(null)
  return <article className="conversation-row" data-conversation-id={row.id} data-selected={selected || undefined}>
    <Button type="button" className="conversation-title justify-start text-left" title={row.title} aria-current={selected ? 'true' : undefined} onClick={onOpen}>{row.title}</Button>
    <DropdownMenu open={Boolean(expanded)} onOpenChange={open => { if (open) onMenu(anchor.current); else onClose?.(true) }}>
      <DropdownMenuTrigger asChild><Button ref={anchor} type="button" id={`conversation-more-${row.id}`} className="conversation-more" aria-label={`会话“${row.title}”的更多操作`} disabled={disabled} onClick={event => event.stopPropagation()}>···</Button></DropdownMenuTrigger>
      {expanded && <ConversationMenu items={items} />}
    </DropdownMenu>
  </article>
}

export default function ConversationMenu({ items }) {
  return <DropdownMenuContent align="end" aria-label="会话操作菜单">
    {items.map(item => <DropdownMenuItem key={item.key} className={item.danger ? 'text-destructive' : item.match ? 'conversation-match' : undefined} disabled={item.disabled} onSelect={item.select}>{item.label}</DropdownMenuItem>)}
  </DropdownMenuContent>
}
