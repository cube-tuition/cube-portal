'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toHtml, sanitizeHtml } from '../../lib/richNotes'

/*
 * CollabDoc — the class's shared page: a single free-flowing page everyone in
 * the class (teacher included) writes into. Notes, reminders, vocab, whatever
 * comes up — and it carries over from week to week. Classes are per-term rows,
 * so scoping by class already scopes by term: a new term starts a fresh page.
 *
 * The body is a small HTML vocabulary (see lib/richNotes): bold, italic,
 * underline, headings, lists and tables. Pages written as plain text before
 * formatting existed are lifted into paragraphs on first open.
 *
 * One row per class; everyone edits the same body. Saves are debounced
 * whole-body writes and the last writer wins — fine for a notes pad, not a
 * merge engine. Realtime keeps every open copy in sync the rest of the time;
 * a remote update is ignored while the local copy has unsaved typing, so it
 * can't yank the words out from under the writer.
 */

const SAVE_DELAY = 900

const TOOLS = [
  { cmd: 'bold',          label: 'B',  title: 'Bold (⌘B)',      cls: 'font-bold' },
  { cmd: 'italic',        label: 'I',  title: 'Italic (⌘I)',    cls: 'italic' },
  { cmd: 'underline',     label: 'U',  title: 'Underline (⌘U)', cls: 'underline' },
  { cmd: 'strikeThrough', label: 'S',  title: 'Strikethrough',  cls: 'line-through' },
  { sep: true },
  { cmd: 'formatBlock', arg: 'H1', label: 'H1', title: 'Heading' },
  { cmd: 'formatBlock', arg: 'H2', label: 'H2', title: 'Subheading' },
  { cmd: 'formatBlock', arg: 'P',  label: '¶',  title: 'Normal text' },
  { sep: true },
  { cmd: 'insertUnorderedList', label: '• list', title: 'Bullet list' },
  { cmd: 'insertOrderedList',   label: '1. list', title: 'Numbered list' },
]

export default function CollabDoc({ classId, meId }) {
  const [body, setBody] = useState(null)     // null = loading; sanitised HTML otherwise
  const [savedAt, setSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [failing, setFailing] = useState(false)
  const [err, setErr] = useState('')
  const [inTable, setInTable] = useState(false)
  const timer = useRef(null)
  const pending = useRef(null)               // unsent html, or null when clean
  const retry = useRef(0)
  const flushRef = useRef(null)
  const edRef = useRef(null)
  const storeKey = `collabdraft:${classId}`

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.from('workbook_collab_docs')
        .select('body, updated_at')
        .eq('class_id', classId).maybeSingle()
      if (!alive) return
      if (error) { setErr('The shared page could not be opened: ' + error.message); return }
      let html = toHtml(data?.body ?? '')
      // A previous session's unsent text (tab closed during an outage) beats
      // the server copy — it was written later and never landed.
      try {
        const draft = localStorage.getItem(storeKey)
        if (draft !== null && draft !== html) { html = toHtml(draft); pending.current = html; setFailing(true) }
        else localStorage.removeItem(storeKey)
      } catch { /* unreadable mirror — server copy stands */ }
      setBody(html)
      setSavedAt(data?.updated_at ?? null)
      if (pending.current !== null) timer.current = setTimeout(() => flushRef.current?.(), 1500)
    })()
    return () => { alive = false }
  }, [classId, storeKey])

  // The editor owns its DOM while typing; React only writes into it when the
  // body changed from OUTSIDE (load, a remote save) — otherwise the caret would
  // jump to the start on every keystroke.
  // Browsers differ on what a keystroke produces (Chrome wraps new lines in
  // <div>, styled <span>s appear after formatting), so the DOM is compared to
  // the body through the sanitiser: cosmetically different, same document.
  const same = (a, b) => a === b || sanitizeHtml(a || '') === sanitizeHtml(b || '')
  useEffect(() => {
    const el = edRef.current
    if (!el || body === null) return
    if (!same(el.innerHTML, body)) el.innerHTML = body
  }, [body])
  useEffect(() => {
    // New lines become <p>, not <div> — the vocabulary the page is stored in.
    try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* older engines */ }
  }, [])

  /* Pull the current server copy — the safety net around realtime. A
     postgres_changes channel can die without saying so, and the page then
     sits there looking healthy and receiving nothing. Skipped while this copy
     has unsaved words of its own. */
  const refresh = useRef(null)
  const pullServerCopy = async () => {
    if (pending.current !== null) return
    const { data, error } = await supabase.from('workbook_collab_docs')
      .select('body, updated_at').eq('class_id', classId).maybeSingle()
    if (error || !data) return
    if (pending.current !== null) return          // typing started mid-flight
    const html = toHtml(data.body ?? '')
    setBody((b) => (same(b, html) ? b : html))
    setSavedAt((t) => (t === data.updated_at ? t : data.updated_at))
  }
  useEffect(() => { refresh.current = pullServerCopy })

  useEffect(() => {
    const onWake = () => { if (document.visibilityState === 'visible') refresh.current?.() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    window.addEventListener('pageshow', onWake)
    const beat = setInterval(onWake, 10000)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
      window.removeEventListener('pageshow', onWake)
      clearInterval(beat)
    }
  }, [classId])

  useEffect(() => {
    const ch = supabase.channel(`collab:${classId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_collab_docs',
        filter: `class_id=eq.${classId}` }, (p) => {
        const r = p.new
        if (!r || pending.current !== null) return
        const html = toHtml(r.body ?? '')
        setBody(b => (same(b, html) ? b : html))
        setSavedAt(r.updated_at)
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') refresh.current?.() })
    return () => { supabase.removeChannel(ch) }
  }, [classId])

  useEffect(() => () => clearTimeout(timer.current), [])

  const flush = async () => {
    clearTimeout(timer.current)
    const html = pending.current
    if (html === null) { setSaving(false); setFailing(false); return }
    const stamp = new Date().toISOString()
    const { error } = await supabase.from('workbook_collab_docs').upsert({
      class_id: classId, body: html, updated_at: stamp, updated_by: meId,
    }, { onConflict: 'class_id' })
    if (error) {
      setFailing(true)
      timer.current = setTimeout(() => flushRef.current?.(), Math.min(30000, 2000 * 2 ** retry.current++))
      return
    }
    retry.current = 0
    setFailing(false)
    setSavedAt(stamp)
    if (pending.current === html) {
      pending.current = null
      setSaving(false)
      try { localStorage.removeItem(storeKey) } catch { /* mirror already gone */ }
    } else {
      timer.current = setTimeout(() => flushRef.current?.(), SAVE_DELAY)
    }
  }
  useEffect(() => { flushRef.current = flush })

  useEffect(() => {
    const warn = (e) => { if (pending.current !== null) { e.preventDefault(); e.returnValue = '' } }
    const onUp = () => flushRef.current?.()
    window.addEventListener('beforeunload', warn)
    window.addEventListener('online', onUp)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('online', onUp) }
  }, [])

  const save = (html) => {
    pending.current = html
    try { localStorage.setItem(storeKey, html) } catch { /* storage blocked — retries still hold it */ }
    setSaving(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current?.(), SAVE_DELAY)
  }

  // Every edit: read the DOM, keep it within the vocabulary, store + save.
  // setBody with the editor's own HTML is a no-op for the DOM (the effect
  // above sees them equal), so the caret stays put.
  // The DOM is left exactly as the browser made it (rewriting it would move the
  // caret); what is STORED is the sanitised form, which is what every other
  // copy of the page receives and what this one shows on its next open.
  const onInput = () => {
    const el = edRef.current
    if (!el) return
    setBody(el.innerHTML); save(sanitizeHtml(el.innerHTML))
  }
  const onPaste = (e) => {
    // Pasted content comes in as text (or cleaned HTML) so a web page's styling
    // never lands on the shared page.
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const insert = html ? sanitizeHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
    document.execCommand('insertHTML', false, insert)
    onInput()
  }
  const exec = (cmd, arg) => { edRef.current?.focus(); document.execCommand(cmd, false, arg); onInput() }

  // ── Tables ────────────────────────────────────────────────────────────────
  const cellAtCaret = () => {
    const sel = window.getSelection(); if (!sel?.anchorNode) return null
    let n = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode
    while (n && n !== edRef.current) { if (n.tagName === 'TD' || n.tagName === 'TH') return n; n = n.parentElement }
    return null
  }
  const trackCaret = () => setInTable(!!cellAtCaret())
  const insertTable = (rows = 3, cols = 3) => {
    const head = `<tr>${Array.from({ length: cols }, () => '<th><br></th>').join('')}</tr>`
    const rest = Array.from({ length: rows - 1 }, () => `<tr>${Array.from({ length: cols }, () => '<td><br></td>').join('')}</tr>`).join('')
    exec('insertHTML', `<table>${head}${rest}</table><p><br></p>`)
  }
  const tableOp = (op) => {
    const cell = cellAtCaret(); if (!cell) return
    const row = cell.parentElement, table = row.closest('table')
    const idx = [...row.children].indexOf(cell)
    if (op === 'row') {
      const nr = row.cloneNode(true); for (const c of nr.children) { const td = document.createElement('td'); td.innerHTML = '<br>'; c.replaceWith(td) }
      row.after(nr)
    } else if (op === 'col') {
      for (const r of table.querySelectorAll('tr')) { const ref = r.children[idx]; const c = document.createElement(ref?.tagName === 'TH' ? 'th' : 'td'); c.innerHTML = '<br>'; ref ? ref.after(c) : r.appendChild(c) }
    } else if (op === 'delrow') {
      if (table.querySelectorAll('tr').length <= 1) table.remove(); else row.remove()
    } else if (op === 'delcol') {
      const n = row.children.length
      if (n <= 1) table.remove(); else for (const r of table.querySelectorAll('tr')) r.children[idx]?.remove()
    } else if (op === 'deltable') table.remove()
    onInput(); trackCaret()
  }
  const onKeyDown = (e) => {
    // Tab moves between cells (adding a row at the end) instead of leaving the page.
    if (e.key === 'Tab') {
      const cell = cellAtCaret(); if (!cell) return
      e.preventDefault()
      const cells = [...cell.closest('table').querySelectorAll('th, td')]
      let i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1)
      if (i >= cells.length) { tableOp('row'); i = cells.length }
      const target = [...cell.closest('table').querySelectorAll('th, td')][Math.max(0, i)]
      if (target) { const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(target); r.collapse(false); sel.removeAllRanges(); sel.addRange(r) }
    }
  }

  if (err && body === null) return <p className="text-sm text-[#B23A3A] py-10 text-center">{err}</p>
  if (body === null) return <p className="text-sm text-[#2A2035]/40 py-10 text-center animate-pulse">Loading…</p>

  const tbtn = 'min-w-[30px] h-7 px-2 rounded-md text-xs text-[#2A2035] hover:bg-[#EEF3FF] hover:text-[#062E63] transition'
  return (
    <div className="max-w-[820px] mx-auto">
      <div className="sticky top-0 z-10 flex items-center gap-0.5 flex-wrap bg-white/95 backdrop-blur border border-[#DEE7FF] rounded-xl px-2 py-1.5 mb-2 shadow-sm">
        {TOOLS.map((t, i) => t.sep
          ? <span key={i} className="w-px h-5 bg-[#DEE7FF] mx-1" />
          : <button key={t.label} type="button" title={t.title} onMouseDown={e => e.preventDefault()} onClick={() => exec(t.cmd, t.arg)} className={`${tbtn} ${t.cls || ''}`}>{t.label}</button>)}
        <span className="w-px h-5 bg-[#DEE7FF] mx-1" />
        <button type="button" title="Insert a 3×3 table" onMouseDown={e => e.preventDefault()} onClick={() => insertTable(3, 3)} className={tbtn}>▦ table</button>
        {inTable && (
          <>
            <button type="button" title="Add a row below" onMouseDown={e => e.preventDefault()} onClick={() => tableOp('row')} className={tbtn}>+ row</button>
            <button type="button" title="Add a column to the right" onMouseDown={e => e.preventDefault()} onClick={() => tableOp('col')} className={tbtn}>+ col</button>
            <button type="button" title="Delete this row" onMouseDown={e => e.preventDefault()} onClick={() => tableOp('delrow')} className={tbtn}>− row</button>
            <button type="button" title="Delete this column" onMouseDown={e => e.preventDefault()} onClick={() => tableOp('delcol')} className={tbtn}>− col</button>
            <button type="button" title="Delete the table" onMouseDown={e => e.preventDefault()} onClick={() => tableOp('deltable')} className={`${tbtn} text-[#B23A3A]`}>✕ table</button>
          </>
        )}
      </div>
      <div className="bg-white rounded-md shadow-[0_1px_4px_rgba(16,32,64,.14)] px-10 md:px-12 py-9 min-h-[560px]">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#325099]/60 mb-4">
          Shared page — everyone in this class writes here, all term
        </p>
        <div
          ref={edRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          data-placeholder="Notes, reminders, vocab, anything — the whole class sees this page…"
          className="collab-editor outline-none text-[15px] leading-[26px] text-[#1c1c1c] min-h-[420px]"
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onKeyUp={trackCaret}
          onMouseUp={trackCaret}
          onFocus={trackCaret}
        />
      </div>
      <p className="text-center text-[11px] text-[#2A2035]/40 py-3">
        {failing ? <span className="text-[#B23A3A] font-semibold">Not saved — retrying…</span>
          : err ? <span className="text-[#B23A3A]">{err}</span>
          : saving ? 'Saving…'
          : savedAt ? `All changes saved · last edited ${new Date(savedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
          : 'All changes saved'}
      </p>
      <style jsx global>{`
        .collab-editor:empty::before { content: attr(data-placeholder); color: rgba(42,32,53,.35); pointer-events: none; }
        .collab-editor p { margin: 0 0 6px; }
        .collab-editor h1 { font-size: 22px; line-height: 30px; font-weight: 700; color: #062E63; margin: 14px 0 6px; }
        .collab-editor h2 { font-size: 17px; line-height: 26px; font-weight: 700; color: #062E63; margin: 12px 0 4px; }
        .collab-editor h3 { font-size: 15px; font-weight: 700; margin: 10px 0 4px; }
        .collab-editor ul { list-style: disc; padding-left: 22px; margin: 4px 0 8px; }
        .collab-editor ol { list-style: decimal; padding-left: 22px; margin: 4px 0 8px; }
        .collab-editor u { text-decoration: underline; }
        .collab-editor table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; table-layout: fixed; }
        .collab-editor th, .collab-editor td { border: 1px solid #C7D5F8; padding: 5px 8px; vertical-align: top; min-width: 60px; }
        .collab-editor th { background: #F0F4FF; font-weight: 700; color: #062E63; text-align: left; }
      `}</style>
    </div>
  )
}
