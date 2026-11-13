import test from 'node:test'
import assert from 'node:assert/strict'
import { handleComposerKeyDown } from '../../src/codex/composerKeyboard.js'

function press(options = {}, state = {}) {
  let sent = 0, prevented = 0
  const event = { key: 'Enter', currentTarget: { form: { requestSubmit() { sent++ } } }, preventDefault() { prevented++ }, ...options }
  handleComposerKeyDown(event, { canSend: true, ...state })
  return { sent, prevented }
}

test('Enter submits through the form exactly once', () => {
  assert.deepEqual(press(), { sent: 1, prevented: 1 })
})
test('Shift+Enter keeps the native newline', () => {
  assert.deepEqual(press({ shiftKey: true }), { sent: 0, prevented: 0 })
})
test('Chinese IME confirmation never submits', () => {
  for (const options of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) {
    assert.deepEqual(press(options), { sent: 0, prevented: 0 })
  }
  assert.deepEqual(press({}, { composing: true }), { sent: 0, prevented: 0 })
})
test('empty or busy input and holding Enter cannot submit', () => {
  assert.deepEqual(press({}, { canSend: false }), { sent: 0, prevented: 1 })
  assert.deepEqual(press({ repeat: true }), { sent: 0, prevented: 1 })
})
test('other keys and modified shortcuts retain normal behavior', () => {
  for (const options of [{ key: 'a' }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    assert.deepEqual(press(options), { sent: 0, prevented: 0 })
  }
})
