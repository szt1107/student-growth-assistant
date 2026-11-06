export function handleComposerKeyDown(event, { canSend, composing = false }) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
  // keyCode 229 also covers IME confirmation in browsers that clear isComposing early.
  if (composing || event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229) return
  event.preventDefault()
  if (canSend && !event.repeat) event.currentTarget.form?.requestSubmit()
}
