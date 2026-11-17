import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadJsx } from './codex/load-jsx.js'

const { default: LoginPage } = await loadJsx(new URL('../src/pages/LoginPage.jsx', import.meta.url))

test('login page renders labeled credentials and a local workspace entry', () => {
  const html = renderToStaticMarkup(createElement(LoginPage))
  assert.match(html, /aria-label="账号登录"/)
  assert.match(html, /for="login-account"/)
  assert.match(html, /autoComplete="username"/)
  assert.match(html, /type="password"/)
  assert.match(html, /autoComplete="current-password"/)
  assert.match(html, /aria-label="显示密码"/)
  assert.match(html, /记住账号/)
  assert.match(html, /href="\/"[^>]*>进入本地工作区/)
  assert.match(html, /href="\/register">注册账号/)
  assert.doesNotMatch(html, /登录成功|忘记密码/)
})

test('registration shares the account page with matching-password fields and a login link', () => {
  const html = renderToStaticMarkup(createElement(LoginPage, { registration: true }))
  assert.match(html, /创建账号/)
  assert.match(html, /aria-label="账号注册"/)
  assert.match(html, /for="register-confirm-password"/)
  assert.equal((html.match(/autoComplete="new-password"/g) || []).length, 2)
  assert.match(html, /aria-label="显示确认密码"/)
  assert.match(html, /href="\/login">去登录/)
  assert.doesNotMatch(html, /记住账号|注册成功/)
})
