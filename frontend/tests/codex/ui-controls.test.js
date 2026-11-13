import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadJsx } from './load-jsx.js'

test('a polymorphic button preserves a link instead of nesting interactive elements', async () => {
  const { Button } = await loadJsx(new URL('../../src/codex/ui/button.jsx', import.meta.url))
  const html = renderToStaticMarkup(React.createElement(Button, { asChild: true, variant: 'outline' }, React.createElement('a', { href: '#tasks' }, '查看任务')))
  assert.match(html, /<a /); assert.match(html, /href="#tasks"/); assert.doesNotMatch(html, /<button/)
})

test('shared form fields retain constraints, fieldset disabling and native selected values', async () => {
  const { Input } = await loadJsx(new URL('../../src/codex/ui/input.jsx', import.meta.url))
  const { NativeSelect } = await loadJsx(new URL('../../src/codex/ui/native-select.jsx', import.meta.url))
  const html = renderToStaticMarkup(React.createElement('fieldset', { disabled: true },
    React.createElement(Input, { name: 'minutes', type: 'number', required: true, min: 5, step: 5, max: 120, defaultValue: 30 }),
    React.createElement(NativeSelect, { name: 'priority', defaultValue: 'normal' }, React.createElement('option', { value: 'normal' }, '普通'))))
  for (const text of ['<fieldset disabled=""', 'name="minutes"', 'required=""', 'min="5"', 'step="5"', 'max="120"', 'value="normal" selected=""']) assert.ok(html.includes(text), text)
})
