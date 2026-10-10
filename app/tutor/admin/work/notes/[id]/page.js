'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../../lib/getProfile'
import TutorNav from '../../../../../../components/TutorNav'
import { toHtml, sanitizeHtml } from '../../../../../../lib/richNotes'

/*
 * One meeting note as its own document — /tutor/admin/work/notes/[id]
 * (directors only). Docs-style: a borderless title, a formatting toolbar,
 * a page-shaped canvas you type straight into, and autosave — no Save button.
 *
 * Same proven machinery as the class CollabDoc: the body is the small HTML
 * vocabulary of lib/richNotes (bold, italic, underline, headings, lists);
 * saves are debounced whole-document writes with retry and a localStorage
 * mirror, so a tab closed mid-outage loses nothing. Notes written as plain
 * text in the old inline editor are lifted into paragraphs on first open.
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
  { cmd: 'insertUnorderedList', label: '• list',  title: 'Bullet list' },
  { cmd: 'insertOrderedList',   label: '1. list', title: 'Numbered list' },
]

const tbtn = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-[#2A2035]/70 hover:text-[#062E63] hover:bg-[#F0F4FF] transition select-none'

export default function WorkNotePage() {
  const router = useRouter()
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [note, setNote]     = useState(null)    // row sans body; null = loading
  const [body, setBody]     = useState(null)    // sanitised HTML
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failing, setFailing] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  const edRef = useRef(null)
  const timer = useRef(null)
  const pending = useRef(null)                  // { title, meeting_date, body } or null
  const retry = useRef(0)
  const flushRef = useRef(null)
  const storeKey = `worknote:${id}`

  // Gate + load.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      if (!alive) return
      setProfile(profile)
      const { data, error } = await supabase.from('work_notes').select('*').eq('id', id).maybeSingle()
      if (!alive) return
      if (error || !data) { setMissing(true); return }
      let html = toHtml(data.body ?? '')
      // A previous session's unsent text beats the server copy — it was
      // written later and never landed.
      try {
        const draft = localStorage.getItem(storeKey)
        if (draft !== null) {
          const d = JSON.parse(draft)
          if (d && typeof d === 'object') {
            html = toHtml(d.body ?? html)
            data.title = d.title ?? data.title
            data.meeting_date = d.meeting_date ?? data.meeting_date
            pending.current = { title: data.title, meeting_date: data.meeting_date, body: html }
            setFailing(true)
          }
        }
      } catch { /* unreadable mirror — server copy stands */ }
      setNote(data)
      setBody(html)
      setSavedAt(data.updated_at ?? null)
      if (pending.current !== null) timer.current = setTimeout(() => flushRef.current?.(), 1500)
    })()
    return () => { alive = false }
  }, [id, router, storeKey])

  // The editor owns its DOM while typing; React only writes into it when the
  // body changed from outside (the load) — otherwise the caret would jump.
  const same = (a, b) => a === b || sanitizeHtml(a || '') === sanitizeHtml(b || '')
  useEffect(() => {
    const el = edRef.current
    if (!el || body === null) return
    if (!same(el.innerHTML, body)) el.innerHTML = body
  }, [body])
  useEffect(() => {
    try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* older engines */ }
  }, [])

  const flush = async () => {
    clearTimeout(timer.current)
    const p = pending.current
    if (p === null) { setSaving(false); setFailing(false); return }
    const stamp = new Date().toISOString()
    const { error } = await supabase.from('work_notes')
      .update({ title: p.title, meeting_date: p.meeting_date, body: p.body, updated_at: stamp })
      .eq('id', id)
    if (error) {
      setFailing(true)
      timer.current = setTimeout(() => flushRef.current?.(), Math.min(30000, 2000 * 2 ** retry.current++))
      return
    }
    retry.current = 0
    setFailing(false)
    setSavedAt(stamp)
    if (pending.current === p) {
      pending.current = null
      setSaving(false)
      try { localStorage.removeItem(storeKey) } catch { /* mirror already gone */ }
    } else {
      timer.current = setTimeout(() => flushRef.current?.(), SAVE_DELAY)
    }
  }
  useEffect(() => { flushRef.current = flush })
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const warn = (e) => { if (pending.current !== null) { e.preventDefault(); e.returnValue = '' } }
    const onUp = () => flushRef.current?.()
    window.addEventListener('beforeunload', warn)
    window.addEventListener('online', onUp)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('online', onUp) }
  }, [])

  const queueSave = useCallback((patch) => {
    setNote(n => {
      const next = { ...n, ...patch }
      const p = {
        title: next.title, meeting_date: next.meeting_date,
        body: patch.body !== undefined ? patch.body : (pending.current?.body ?? sanitizeHtml(edRef.current?.innerHTML || '')),
      }
      pending.current = p
      try { localStorage.setItem(storeKey, JSON.stringify(p)) } catch { /* retries still hold it */ }
      return next
    })
    setSaving(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current?.(), SAVE_DELAY)
  }, [storeKey])

  const onInput = () => {
    const el = edRef.current
    if (!el) return
    setBody(el.innerHTML)
    queueSave({ body: sanitizeHtml(el.innerHTML) })
  }
  const onPaste = (e) => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const insert = html ? sanitizeHtml(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
    document.execCommand('insertHTML', false, insert)
    onInput()
  }
  const exec = (cmd, arg) => { edRef.current?.focus(); document.execCommand(cmd, false, arg); onInput() }

  const deleteNote = async () => {
    if (!confirm(`Delete "${note?.title || 'this note'}"? This can't be undone.`)) return
    const { error } = await supabase.from('work_notes').delete().eq('id', id)
    if (error) { alert('Could not delete the note: ' + error.message); return }
    pending.current = null
    try { localStorage.removeItem(storeKey) } catch { /* gone anyway */ }
    router.push('/tutor/admin/work')
  }

  if (missing) {
    return (
      <div className="min-h-screen bg-[#F0F4FF]">
        <TutorNav staffName={profile?.full_name} isAdmin />
        <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-3">
          <p className="text-sm text-[#2A2035]/60">This note doesn’t exist any more.</p>
          <Link href="/tutor/admin/work" className="text-sm font-semibold text-[#325099] hover:underline">← Back to Work</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-[880px] mx-auto px-4 py-6">

        {/* Doc header */}
        <div className="flex items-center gap-3 mb-1">
          <Link href="/tutor/admin/work" className="text-xs font-semibold text-[#325099] hover:underline shrink-0">← Work</Link>
          <span className="text-[11px] text-[#2A2035]/40 min-w-0 truncate">
            {failing ? <span className="text-[#B23A3A] font-semibold">Not saved — retrying…</span>
              : saving ? 'Saving…'
              : savedAt ? `All changes saved · ${new Date(savedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
              : ''}
          </span>
          <span className="flex-1" />
          <input
            type="date"
            value={note?.meeting_date || ''}
            onChange={e => queueSave({ meeting_date: e.target.value || note?.meeting_date })}
            className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099] shrink-0"
          />
          <button onClick={deleteNote} title="Delete this note"
            className="text-[11px] font-semibold text-red-300 hover:text-red-500 transition shrink-0">Delete</button>
        </div>

        {note === null ? (
          <p className="text-sm text-[#2A2035]/40 py-16 text-center animate-pulse">Opening…</p>
        ) : (
          <>
            {/* Title — borderless, like a doc */}
            <input
              value={note.title}
              onChange={e => queueSave({ title: e.target.value })}
              placeholder="Untitled note"
              className="w-full bg-transparent text-[26px] md:text-3xl font-bold text-[#062E63] focus:outline-none placeholder:text-[#062E63]/30 mb-3"
            />

            {/* Toolbar */}
            <div className="sticky top-[73px] z-10 flex items-center gap-0.5 flex-wrap bg-white/95 backdrop-blur border border-[#DEE7FF] rounded-xl px-2 py-1.5 mb-3 shadow-sm">
              {TOOLS.map((t, i) => t.sep
                ? <span key={i} className="w-px h-5 bg-[#DEE7FF] mx-1" />
                : <button key={t.label} type="button" title={t.title}
                    onMouseDown={e => e.preventDefault()} onClick={() => exec(t.cmd, t.arg)}
                    className={`${tbtn} ${t.cls || ''}`}>{t.label}</button>)}
            </div>

            {/* The page */}
            <div
              ref={edRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Agenda, decisions, who does what…"
              onInput={onInput}
              onPaste={onPaste}
              className="worknote-editor bg-white border border-[#DEE7FF] rounded-2xl shadow-sm px-8 md:px-14 py-10 min-h-[68vh] text-[15px] leading-[1.75] text-[#2A2035] focus:outline-none"
            />
            <style jsx global>{`
              .worknote-editor:empty::before { content: attr(data-placeholder); color: rgba(42,32,53,.35); pointer-events: none; }
              .worknote-editor p { margin: 0 0 7px; }
              .worknote-editor h1 { font-size: 23px; line-height: 31px; font-weight: 700; color: #062E63; margin: 16px 0 7px; }
              .worknote-editor h2 { font-size: 18px; line-height: 27px; font-weight: 700; color: #062E63; margin: 13px 0 5px; }
              .worknote-editor h3 { font-size: 15px; font-weight: 700; margin: 10px 0 4px; }
              .worknote-editor ul { list-style: disc; padding-left: 24px; margin: 4px 0 8px; }
              .worknote-editor ol { list-style: decimal; padding-left: 24px; margin: 4px 0 8px; }
              .worknote-editor u { text-decoration: underline; }
              .worknote-editor table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; table-layout: fixed; }
              .worknote-editor th, .worknote-editor td { border: 1px solid #C7D5F8; padding: 5px 8px; vertical-align: top; overflow-wrap: anywhere; }
              .worknote-editor th { background: #F0F4FF; font-weight: 700; color: #062E63; text-align: left; }
            `}</style>
          </>
        )}
      </div>
    </div>
  )
}
