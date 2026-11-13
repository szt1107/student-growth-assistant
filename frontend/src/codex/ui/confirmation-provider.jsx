import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from './alert-dialog.jsx'
import { Button } from './button.jsx'
const ConfirmationContext = createContext(null)

export function ConfirmationProvider({ children }) {
  const [message, setMessage] = useState(null), current = useRef(null), returnFocus = useRef(null)
  const confirm = useCallback(description => {
    if (current.current) return Promise.resolve(false)
    returnFocus.current = document.activeElement
    return new Promise(resolve => { current.current = resolve; setMessage(description) })
  }, [])
  const finish = useCallback(value => { const resolve = current.current; current.current = null; setMessage(null); resolve?.(value) }, [])
  useEffect(() => () => { current.current?.(false); current.current = null }, [])
  return <ConfirmationContext.Provider value={confirm}>{children}<AlertDialog open={message !== null} onOpenChange={open => { if (!open) finish(false) }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; if (target?.isConnected && !target.closest('[hidden],[inert]')) target.focus({ preventScroll: true }) }}><AlertDialogTitle>确认这次操作</AlertDialogTitle><AlertDialogDescription>{message}</AlertDialogDescription><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => finish(false)}>取消</Button><Button type="button" onClick={() => finish(true)}>确认继续</Button></div></AlertDialogContent></AlertDialog></ConfirmationContext.Provider>
}
export function useConfirmation() {
  const confirm = useContext(ConfirmationContext)
  if (!confirm) throw new Error('确认操作需要 ConfirmationProvider')
  return confirm
}
