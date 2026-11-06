import { useRef, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogTrigger, AlertDialogCancel } from './alert-dialog.jsx'
import { Button } from './button.jsx'
import { Alert } from './alert.jsx'

export function ConfirmAction({ trigger, title, description, onConfirm, busy = false, destructive = false }) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('')
  const lock = useRef(false)
  async function confirm() {
    if (lock.current || busy) return
    lock.current = true; setPending(true); setError('')
    try { await onConfirm(); setOpen(false) }
    catch (cause) { setError(cause.message || '未能完成操作，请重试。') }
    finally { lock.current = false; setPending(false) }
  }
  return <AlertDialog open={open} onOpenChange={value => { if (!lock.current && !busy) { setOpen(value); if (value) setError('') } }}><AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger><AlertDialogContent onEscapeKeyDown={event => { if (pending || busy) event.preventDefault() }}><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription>{error && <Alert role="alert" variant="destructive">{error}</Alert>}<div className="flex flex-wrap justify-end gap-2"><AlertDialogCancel asChild><Button type="button" variant="outline" disabled={pending || busy}>取消</Button></AlertDialogCancel><Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={pending || busy} onClick={confirm}>{pending ? '处理中…' : '确认'}</Button></div></AlertDialogContent></AlertDialog>
}
