import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Eye, EyeOff } from 'lucide-react'
import { Button, Input, Label } from '../codex/ui/controls.js'
import { loginAccount, registerAccount } from '../api.js'
import './login.css'

const rememberedAccountKey = 'sga-login-account'

export default function LoginPage({ registration = false }) {
  const [account, setAccount] = useState(() => {
    if (registration) return ''
    try { return localStorage.getItem(rememberedAccountKey) || '' }
    catch { return '' }
  })
  const [rememberAccount, setRememberAccount] = useState(Boolean(account))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [message, setMessage] = useState('')
  const [invalidField, setInvalidField] = useState('')
  const [busy, setBusy] = useState(false)
  const accountInput = useRef(null)
  const confirmationInput = useRef(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = registration ? '注册 · 生长' : '登录 · 生长'
    return () => { document.title = previousTitle }
  }, [registration])

  function clearMessage() {
    setMessage('')
    setInvalidField('')
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const name = account.trim()
    if (!name) {
      setMessage('请输入账号。')
      setInvalidField('account')
      accountInput.current?.focus()
      return
    }
    if (registration) {
      if (password !== confirmation) {
        setMessage('两次输入的密码不一致，请重新确认。')
        setInvalidField('confirmation')
        confirmationInput.current?.focus()
        return
      }
    }
    setInvalidField('')
    setMessage('')
    setBusy(true)
    try {
      await (registration ? registerAccount : loginAccount)({ account: name, password })
      if (!registration) {
        try {
          if (rememberAccount) localStorage.setItem(rememberedAccountKey, name)
          else localStorage.removeItem(rememberedAccountKey)
        } catch { /* Remembering an account is optional device storage. */ }
      }
      window.location.replace('/')
    } catch (cause) {
      setMessage(cause.message)
      setInvalidField(cause.code === 'ACCOUNT_EXISTS' ? 'account' : 'form')
      if (cause.code === 'ACCOUNT_EXISTS') accountInput.current?.focus()
    } finally { setBusy(false) }
  }

  return <div className="login-page">
    <header className="login-header">
      <div className="login-brand" aria-label="生长，大学生成长助手">
        <span className="login-brand-name">生长</span>
        <span className="login-brand-caption">大学生成长助手</span>
      </div>
      <a className="login-workspace-link" href="/">进入本地工作区<ArrowUpRight aria-hidden="true" /></a>
    </header>

    <main className="login-main">
      <section className="login-card" aria-labelledby="login-heading">
        <h1 id="login-heading">{registration ? '创建账号' : '欢迎回来'}</h1>
        <form className="login-form" aria-label={registration ? '账号注册' : '账号登录'} onSubmit={submit}>
          <div className="login-field">
            <Label htmlFor="login-account">账号</Label>
            <Input id="login-account" ref={accountInput} name="username" type="text" required disabled={busy}
              autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="输入用户名或邮箱" value={account}
              aria-invalid={invalidField === 'account'} aria-describedby={invalidField === 'account' ? 'login-message' : undefined}
              onChange={event => { setAccount(event.target.value); clearMessage() }} />
          </div>
          <div className="login-field">
            <Label htmlFor="login-password">密码</Label>
            <div className="login-password-field">
              <Input id="login-password" name="password" type={showPassword ? 'text' : 'password'} required disabled={busy}
                autoComplete={registration ? 'new-password' : 'current-password'} placeholder="输入密码" value={password}
                onChange={event => { setPassword(event.target.value); clearMessage() }} />
              <Button type="button" variant="ghost" size="icon" className="login-password-toggle"
                aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}
                aria-controls="login-password" onClick={() => setShowPassword(value => !value)}>
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          {registration && <div className="login-field">
            <Label htmlFor="register-confirm-password">确认密码</Label>
            <div className="login-password-field">
              <Input id="register-confirm-password" ref={confirmationInput} name="password_confirmation"
                type={showConfirmation ? 'text' : 'password'} required autoComplete="new-password" disabled={busy}
                placeholder="再次输入密码" value={confirmation}
                aria-invalid={invalidField === 'confirmation'} aria-describedby={invalidField === 'confirmation' ? 'login-message' : undefined}
                onChange={event => { setConfirmation(event.target.value); clearMessage() }} />
              <Button type="button" variant="ghost" size="icon" className="login-password-toggle"
                aria-label={showConfirmation ? '隐藏确认密码' : '显示确认密码'} aria-pressed={showConfirmation}
                aria-controls="register-confirm-password" onClick={() => setShowConfirmation(value => !value)}>
                {showConfirmation ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>}
          {!registration && <Label className="login-remember" htmlFor="login-remember">
            <Input id="login-remember" type="checkbox" checked={rememberAccount} disabled={busy}
              onChange={event => setRememberAccount(event.target.checked)} />
            记住账号
          </Label>}
          <Button type="submit" variant="default" className="login-submit" disabled={busy}>{busy ? registration ? '正在注册…' : '正在登录…' : registration ? '注册' : '登录'}</Button>
          {message && <p id="login-message" className="login-message" role={invalidField ? 'alert' : 'status'}>{message}</p>}
        </form>
        <p className="login-switch">{registration ? '已有账号？' : '还没有账号？'}
          <a href={registration ? '/login' : '/register'}>{registration ? '去登录' : '注册账号'}</a>
        </p>
      </section>
    </main>
  </div>
}
