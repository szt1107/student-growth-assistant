import { useEffect, useState } from 'react'
import { getAccountSession, setAccountIdentity } from '../api.js'
import { Button } from '../codex/ui/controls.js'

export default function AccountGate({ children }) {
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    setError('')
    getAccountSession().then(next => {
      if (!alive) return
      if (next.required && !next.user) {
        window.location.replace('/login')
        return
      }
      setAccountIdentity(next.user?.id || null)
      setSession(next)
    }).catch(cause => { if (alive) setError(cause.message) })
    return () => { alive = false }
  }, [retry])

  if (!session) return <main className="state-box" role="status">
    {error || '正在验证登录状态…'}
    {error && <Button onClick={() => setRetry(value => value + 1)}>重试</Button>}
  </main>
  return children
}
