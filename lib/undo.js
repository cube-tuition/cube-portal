/*
 * Portal-wide undo service — one Ctrl/Cmd+Z shortcut for every admin page.
 *
 * Pages register reversible actions as they happen:
 *   import { registerUndoAction } from '../lib/undo'
 *   registerUndoAction('Trial status change', async () => { ...restore old value... })
 *
 * <GlobalUndo /> (mounted inside TutorNav, so it exists on every tutor page)
 * listens for Ctrl/Cmd+Z and pops the most recent action, showing a toast.
 *
 * A page with its own richer undo system (the database explorer) can take over
 * the shortcut while mounted via setUndoHandler(fn); the global stack resumes
 * when it unmounts.
 *
 * The shortcut is ignored while focus is in an input/textarea/select or
 * contentEditable element — native text undo always wins there.
 */

const MAX_STACK = 50

let stack = []          // [{ label, undo: async () => void }]
let override = null     // page-scoped handler (e.g. database explorer)
const toastListeners = new Set()

export function registerUndoAction(label, undoFn) {
  stack.push({ label, undo: undoFn })
  if (stack.length > MAX_STACK) stack.shift()
}

/** Page takes over Ctrl/Cmd+Z while mounted. Returns a cleanup function. */
export function setUndoHandler(fn) {
  override = fn
  return () => { if (override === fn) override = null }
}

export function subscribeUndoToast(fn) {
  toastListeners.add(fn)
  return () => toastListeners.delete(fn)
}
const emitToast = (msg, ok) => toastListeners.forEach((fn) => fn({ msg, ok, at: Date.now() }))

/** Pages with their own undo handler can surface a toast through the shared UI. */
export const announceUndo = emitToast

export async function performUndo() {
  if (override) { await override(); return }
  const action = stack.pop()
  if (!action) { emitToast('Nothing to undo', false); return }
  try {
    await action.undo()
    emitToast(`Undone: ${action.label}`, true)
  } catch (e) {
    emitToast(`Undo failed: ${e?.message || e}`, false)
  }
}

export function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
