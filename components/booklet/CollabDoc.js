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
  const [err, setErr] = useState('')
  const timer = useRef(null)
  const dirty = useRef(false)
  const taRef = useRef(null)

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
      setBody(data?.body ?? '')
      setSavedAt(data?.updated_at ?? null)
    })()
    return () => { alive = false }
  }, [classId])

  // Live sync — another writer's save lands here. Skipped while this copy has
  // unsaved typing of its own.
  useEffect(() => {
    const ch = supabase.channel(`collab:${classId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_collab_docs',
        filter: `class_id=eq.${classId}` }, (p) => {
        const r = p.new
        if (!r || dirty.current) return
        setBody(b => (b === r.body ? b : r.body))
        setSavedAt(r.updated_at)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [classId])

  useEffect(() => { grow() }, [body])
  useEffect(() => () => clearTimeout(timer.current), [])

  const save = (text) => {
    dirty.current = true
    setSaving(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const stamp = new Date().toISOString()
      const { error } = await supabase.from('workbook_collab_docs').upsert({
        class_id: classId, body: text,
        updated_at: stamp, updated_by: meId,
      }, { onConflict: 'class_id' })
      dirty.current = false
      setSaving(false)
      if (error) setErr('Saving failed: ' + error.message)
      else { setErr(''); setSavedAt(stamp) }
    }, SAVE_DELAY)
  }

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
        {err ? <span className="text-[#B23A3A]">{err}</span>
          : saving ? 'Saving…'
          : savedAt ? `All changes saved · last edited ${new Date(savedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
          : 'All changes saved'}
      </p>
    </div>
  )
}
