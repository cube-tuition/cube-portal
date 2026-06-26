/*
 * Rich-text keyboard shortcuts for plain textareas, shared by the workbook
 * builder (BlockEditor) and the question builder (LatexField). They insert the
 * marker syntax the renderers understand:
 *   **bold**  ·  ^superscript^  ·  ~subscript~  ·  "-> " centre a line  ·
 *   "- " / 2-space indent for (nested) bullet lists.
 */

// Cmd/Ctrl+B → wrap (or unwrap) the selection in **…** for bold.
export function onBold(e, value, setValue) {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b')) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const sel = value.slice(s, en)
  let next, caret
  if (sel && /^\*\*[\s\S]+\*\*$/.test(sel)) {            // already bold → unwrap
    const inner = sel.slice(2, -2)
    next = value.slice(0, s) + inner + value.slice(en)
    caret = s + inner.length
  } else {
    const wrapped = sel ? `**${sel}**` : '****'
    next = value.slice(0, s) + wrapped + value.slice(en)
    caret = sel ? s + wrapped.length : s + 2
  }
  setValue(next)
  requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = caret } catch { /* noop */ } })
}

// Cmd/Ctrl+E → toggle centre alignment on the current line(s) by adding/removing
// a leading "-> " marker (the renderer centres lines that start with it).
export function onCentre(e, value, setValue) {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e')) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  let lineEnd = value.indexOf('\n', en)
  if (lineEnd === -1) lineEnd = value.length
  const segment = value.slice(lineStart, lineEnd)
  const lines = segment.split('\n')
  const nonEmpty = lines.filter(l => l.trim() !== '')
  const allCentred = nonEmpty.length > 0 && nonEmpty.every(l => /^->\s?/.test(l))
  const newSegment = lines.map(l => {
    if (l.trim() === '') return l
    return allCentred ? l.replace(/^->\s?/, '') : (/^->\s?/.test(l) ? l : `-> ${l}`)
  }).join('\n')
  const next = value.slice(0, lineStart) + newSegment + value.slice(lineEnd)
  setValue(next)
  const delta = newSegment.length - segment.length
  requestAnimationFrame(() => { try { el.selectionStart = lineStart; el.selectionEnd = lineEnd + delta } catch { /* noop */ } })
}

// Tab → indent the current line(s) by 2 spaces (a sub-dot-point); Shift+Tab →
// outdent. Prevents the default focus-change so Tab nests bullets like in Word.
export function onIndent(e, value, setValue) {
  if (e.key !== 'Tab') return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  let lineEnd = value.indexOf('\n', en)
  if (lineEnd === -1) lineEnd = value.length
  const segment = value.slice(lineStart, lineEnd)
  const lines = segment.split('\n')
  const outdent = e.shiftKey
  const firstRemoved = outdent ? (lines[0].match(/^ {1,2}/)?.[0].length || 0) : 0
  const newSegment = lines.map(l => outdent ? l.replace(/^ {1,2}/, '') : `  ${l}`).join('\n')
  const next = value.slice(0, lineStart) + newSegment + value.slice(lineEnd)
  setValue(next)
  const delta = newSegment.length - segment.length
  requestAnimationFrame(() => {
    try {
      if (s === en) {
        const caret = outdent ? Math.max(lineStart, s - firstRemoved) : s + 2
        el.selectionStart = el.selectionEnd = caret
      } else {
        el.selectionStart = lineStart
        el.selectionEnd = lineEnd + delta
      }
    } catch { /* noop */ }
  })
}

// Superscript (⌘/Ctrl+Shift+=) and subscript (⌘/Ctrl+Shift+-): wrap the selection
// in ^…^ / ~…~ (the renderer turns these into <sup>/<sub>). Toggles off if already
// wrapped. Uses e.code so it's independent of the shifted character.
export function onSubSup(e, value, setValue) {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || !e.shiftKey) return
  let marker = null
  if (e.code === 'Equal' || e.key === '+' || e.key === '=') marker = '^'        // superscript
  else if (e.code === 'Minus' || e.key === '_' || e.key === '-') marker = '~'   // subscript
  if (!marker) return
  e.preventDefault()
  const el = e.target
  const s = el.selectionStart, en = el.selectionEnd
  const sel = value.slice(s, en)
  const wrapped = marker === '^' ? /^\^[\s\S]+\^$/ : /^~[\s\S]+~$/
  let next, caret
  if (sel && wrapped.test(sel)) {              // already wrapped → unwrap
    const inner = sel.slice(1, -1)
    next = value.slice(0, s) + inner + value.slice(en)
    caret = s + inner.length
  } else {
    const w = sel ? `${marker}${sel}${marker}` : `${marker}${marker}`
    next = value.slice(0, s) + w + value.slice(en)
    caret = sel ? s + w.length : s + 1
  }
  setValue(next)
  requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = caret } catch { /* noop */ } })
}

// Inline fields (table cells, options, part prompts): bold + sub/superscript.
export function onInlineKey(e, value, setValue) {
  onBold(e, value, setValue)
  onSubSup(e, value, setValue)
}

// Rich body textareas: bold, centre, sub/superscript, and Tab/Shift-Tab indent.
export function onTextKey(e, value, setValue) {
  onBold(e, value, setValue)
  onSubSup(e, value, setValue)
  onCentre(e, value, setValue)
  onIndent(e, value, setValue)
}
