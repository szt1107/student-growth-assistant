import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getAccountSession, registerAccount, loginAccount, logoutAccount, getTasks, setAccountIdentity } from '../src/api.js'
import { loadJsx } from './codex/load-jsx.js'

const { default: AccountGate } = await loadJsx(new URL('../src/components/AccountGate.jsx', import.meta.url))

test('workspace content waits for an authenticated session', () => {
  const html = renderToStaticMarkup(createElement(AccountGate, null, 'PRIVATE_WORKSPACE'))
  assert.match(html, /正在验证登录状态/)
  assert.doesNotMatch(html, /PRIVATE_WORKSPACE/)
})

test('account requests carry session cookies and workspace requests carry the expected account', async () => {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ user: { id: 'account-a', account: 'alice' } }) }
  }
  try {
    await getAccountSession()
    await registerAccount({ account: 'alice', password: 'test-only' })
    await loginAccount({ account: 'alice', password: 'test-only' })
    setAccountIdentity('account-a')
    await getTasks()
    await logoutAccount()
    assert.ok(calls.every(call => call.options.credentials === 'include'))
    assert.match(calls[1].url, /\/api\/auth\/register$/)
    assert.deepEqual(JSON.parse(calls[1].options.body), { account: 'alice', password: 'test-only' })
    assert.equal(calls[3].options.headers['X-Account-Id'], 'account-a')
    assert.equal(calls[4].options.headers['X-Account-Id'], undefined)
    assert.equal(calls[4].options.method, 'POST')
  } finally {
    globalThis.fetch = previous
    setAccountIdentity(null)
  }
})
