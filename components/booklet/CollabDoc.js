'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

/*
 * CollabDoc — the class's shared page: a single free-flowing text everyone in
 * the class (teacher included) writes into. Notes, reminders, vocab, whatever
 * comes up — and it carries over from week to week. Classes are per-term rows,
 * so scoping by class already scopes by term: a new term starts a fresh page.
 *
 * One row per class; everyone edits the same body. Saves are
 * debounced whole-body writes and the last writer wins — fine for a notes pad,
 * not a merge engine: if two people type in the very same moment, the later
 * save keeps its own view of the page. Realtime keeps every open copy in sync
 * the rest of the time; a remote update is ignored while the local copy has
 * unsaved typing, so it can't yank the words out from under the writer.
 */

const SAVE_DELAY = 900

export default function CollabDoc({ classId, meId }) {
  const [body, setBody] = useState(null)     // null = loading
  const [savedAt, setSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [failing, setFailing] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef(null)
  const pending = useRef(null)               // unsent text, or null when clean
  const retry = useRef(0)
  const flushRef = useRef(null)
  const taRef = useRef(null)
  const storeKey = `collabdraft:${classId}`

  const grow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(420, el.scrollHeight)}px`
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.from('workbook_collab_docs')
        .select('body, updated_at')
        .eq('class_id', classId).maybeSingle()
      if (!alive) return
      if (error) { setErr('The shared page could not be opened: ' + error.message); return }
      let text = data?.body ?? ''
      // A previous session's unsent text (tab closed during an outage) beats
      // the server copy — it was written later and never landed.
      try {
        const draft = localStorage.getItem(storeKey)
        if (draft !== null && draft !== text) { text = draft; pending.current = draft; setFailing(true) }
        else localStorage.removeItem(storeKey)
      } catch { /* unreadable mirror — server copy stands */ }
      setBody(text)
      setSavedAt(data?.updated_at ?? null)
      if (pending.current !== null) timer.current = setTimeout(() => flushRef.current?.(), 1500)
    })()
    return () => { alive = false }
  }, [classId, storeKey])

  // Live sync — another writer's save lands here. Skipped while this copy has
  // unsaved typing of its own.
  useEffect(() => {
    const ch = supabase.channel(`collab:${classId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_collab_docs',
        filter: `class_id=eq.${classId}` }, (p) => {
        const r = p.new
        if (!r || pending.current !== null) return
        setBody(b => (b === r.body ? b : r.body))
        setSavedAt(r.updated_at)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [classId])

  useEffect(() => { grow() }, [body])
  useEffect(() => () => clearTimeout(timer.current), [])

  /* Same safety net as the workbook: unsent text is mirrored to localStorage
     and retried on a backoff, and the status line says so instead of lying. */
  const flush = async () => {
    clearTimeout(timer.current)
    const text = pending.current
    if (text === null) { setSaving(false); setFailing(false); return }
    const stamp = new Date().toISOString()
    const { error } = await supabase.from('workbook_collab_docs').upsert({
      class_id: classId, body: text, updated_at: stamp, updated_by: meId,
    }, { onConflict: 'class_id' })
    if (error) {
      setFailing(true)
      timer.current = setTimeout(() => flushRef.current?.(), Math.min(30000, 2000 * 2 ** retry.current++))
      return
    }
    retry.current = 0
    setFailing(false)
    setSavedAt(stamp)
    // Clear only if nothing newer was typed while the save was in flight.
    if (pending.current === text) {
      pending.current = null
      setSaving(false)
      try { localStorage.removeItem(storeKey) } catch { /* mirror already gone */ }
    } else {
      timer.current = setTimeout(() => flushRef.current?.(), SAVE_DELAY)
    }
  }
  useEffect(() => { flushRef.current = flush })

  const save = (text) => {
    pending.current = text
    try { localStorage.setItem(storeKey, text) } catch { /* storage blocked — retries still hold it */ }
    setSaving(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current?.(), SAVE_DELAY)
  }

  useEffect(() => {
    const warn = (e) => { if (pending.current !== null) { e.preventDefault(); e.returnValue = '' } }
    const onUp = () => flushRef.current?.()
    window.addEventListener('beforeunload', warn)
    window.addEventListener('online', onUp)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('online', onUp) }
  }, [])

  if (err && body === null) return <p className="text-sm text-[#B23A3A] py-10 text-center">{err}</p>
  if (body === null) return <p className="text-sm text-[#2A2035]/40 py-10 text-center animate-pulse">Loading…</p>

  return (
    <div className="max-w-[820px] mx-auto">
      <div className="bg-white rounded-md shadow-[0_1px_4px_rgba(16,32,64,.14)] px-10 md:px-12 py-9 min-h-[560px]">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#325099]/60 mb-4">
          Shared page — everyone in this class writes here, all term
        </p>
        <textarea
          ref={taRef}
          className="w-full border-0 outline-none resize-none text-[15px] leading-[26px] text-[#1c1c1c] bg-transparent"
          style={{ minHeight: 420 }}
          value={body}
          placeholder="Notes, reminders, vocab, anything — the whole class sees this page…"
          onChange={(e) => { setBody(e.target.value); save(e.target.value); grow() }}
        />
      </div>
      <p className="text-center text-[11px] text-[#2A2035]/40 py-3">
        {failing ? <span className="text-[#B23A3A] font-semibold">Not saved — retrying…</span>
          : err ? <span className="text-[#B23A3A]">{err}</span>
          : saving ? 'Saving…'
          : savedAt ? `All changes saved · last edited ${new Date(savedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
          : 'All changes saved'}
      </p>
    </div>
  )
}
