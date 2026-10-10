'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { DUE_DATES, daysUntil } from '../../../../lib/complianceDates'
import { htmlToText } from '../../../../lib/richNotes'

/*
 * Work — /tutor/admin/work (directors only)
 *
 * The directors' work centre: the running to-do between Ryan and Aiden
 * (ops_tasks — add, assign, tick off), meeting notes (work_notes), and every
 * upcoming due date in one strip — open task deadlines merged with the
 * compliance calendar (BAS, super, tax), honouring the same done-marks the
 * Accounting page keeps in portal_settings.
 */

const COMPLIANCE_DONE_KEY = 'compliance_done'
const ASSIGNEES = ['Ryan', 'Aiden', 'Both']

const fmtD = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  : ''
const fmtDLong = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  : ''
const todayISO = () => new Date().toLocaleDateString('en-CA')   // local, not UTC

// Due chip styling by urgency.
const dueCls = (days) =>
  days < 0 ? 'bg-[#FEE2E2] text-[#991B1B]'
  : days <= 7 ? 'bg-[#FEF3C7] text-[#92400E]'
  : 'bg-[#F0F4FF] text-[#325099]'
const dueLabel = (days, iso) =>
  days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : fmtD(iso)

export default function WorkPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks]     = useState([])
  const [notes, setNotes]     = useState([])
  const [complianceDone, setComplianceDone] = useState({})
  const [error, setError]     = useState(null)

  // Task add form
  const [tTitle, setTTitle]   = useState('')
  const [tDue, setTDue]       = useState('')
  const [tWho, setTWho]       = useState('Both')
  const [showDone, setShowDone] = useState(false)

  const [creatingNote, setCreatingNote] = useState(false)

  const load = useCallback(async () => {
    const [t, n, c] = await Promise.all([
      supabase.from('ops_tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('work_notes').select('*').order('meeting_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('portal_settings').select('value').eq('key', COMPLIANCE_DONE_KEY).maybeSingle(),
    ])
    if (t.error) setError(`Tasks failed to load: ${t.error.message}`)
    if (n.error) setError(`Notes failed to load: ${n.error.message}`)
    setTasks(t.data || [])
    setNotes(n.data || [])
    try { setComplianceDone(JSON.parse(c.data?.value || '{}')) } catch { setComplianceDone({}) }
  }, [])

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)
      await load()
      setLoading(false)
    })()
  }, [router, load])

  // ── Due dates strip: open task deadlines + un-done compliance dates ────────
  const upcoming = useMemo(() => {
    const items = []
    for (const t of tasks) {
      if (t.status === 'done' || !t.due_date) continue
      items.push({ key: `task-${t.id}`, icon: '✅', label: t.title, due: t.due_date, kind: t.assignee || 'task' })
    }
    for (const d of DUE_DATES) {
      if (complianceDone[d.label]) continue
      const days = daysUntil(d.due)
      if (days < -60 || days > 90) continue        // keep the strip current
      items.push({ key: `comp-${d.label}`, icon: d.icon || '📆', label: d.label, due: d.due, kind: d.category })
    }
    return items.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 10)
  }, [tasks, complianceDone])

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const openTasks = useMemo(() =>
    tasks.filter(t => t.status !== 'done').sort((a, b) =>
      (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.created_at || '').localeCompare(b.created_at || '')),
    [tasks])
  const doneTasks = useMemo(() =>
    tasks.filter(t => t.status === 'done').sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, 15),
    [tasks])

  const addTask = async () => {
    const title = tTitle.trim()
    if (!title) return
    const row = {
      title, due_date: tDue || null, assignee: tWho === 'Both' ? null : tWho,
      status: 'open', source: 'manual', created_by: profile?.full_name || null,
    }
    const { data, error: err } = await supabase.from('ops_tasks').insert(row).select('*').single()
    if (err) { setError(`Could not add the task: ${err.message}`); return }
    setTasks(prev => [data, ...prev])
    setTTitle(''); setTDue('')
  }
  const setTaskDone = async (task, done) => {
    const patch = done ? { status: 'done', done_at: new Date().toISOString() } : { status: 'open', done_at: null }
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t))
    const { error: err } = await supabase.from('ops_tasks').update(patch).eq('id', task.id)
    if (err) { setError(`Could not update the task: ${err.message}`); load() }
  }
  const deleteTask = async (task) => {
    if (!confirm(`Delete "${task.title}"?`)) return
    const { error: err } = await supabase.from('ops_tasks').delete().eq('id', task.id)
    if (err) { setError(`Could not delete the task: ${err.message}`); return }
    setTasks(prev => prev.filter(t => t.id !== task.id))
  }

  // ── Notes — each one is its own document page ──────────────────────────────
  const newNote = async () => {
    setCreatingNote(true)
    const { data, error: err } = await supabase.from('work_notes')
      .insert({ title: `Meeting — ${fmtDLong(todayISO())}`, body: '', meeting_date: todayISO(), created_by: profile?.full_name || null })
      .select('id').single()
    setCreatingNote(false)
    if (err) { setError(`Could not create the note: ${err.message}`); return }
    router.push(`/tutor/admin/work/notes/${data.id}`)
  }
  const deleteNote = async (note) => {
    if (!confirm(`Delete "${note.title}"? This can't be undone.`)) return
    const { error: err } = await supabase.from('work_notes').delete().eq('id', note.id)
    if (err) { setError(`Could not delete the note: ${err.message}`); return }
    setNotes(prev => prev.filter(n => n.id !== note.id))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4FF]">
        <TutorNav staffName={profile?.full_name} isAdmin />
        <div className="flex justify-center py-24"><div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-7xl mx-auto px-4 md:px-10 py-8 space-y-6">

        <div>
          <h1 className="text-2xl font-bold text-[#062E63]">Work</h1>
          <p className="text-sm text-[#325099]/60 mt-0.5">Meeting notes, due dates and the running to-do between directors</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">×</button>
          </div>
        )}

        {/* ── Due dates strip ── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <p className="text-xs font-bold text-[#062E63] mb-3">📆 Coming up</p>
          {upcoming.length === 0 ? (
            <p className="text-xs text-[#2A2035]/40">Nothing due — task deadlines and compliance dates land here.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {upcoming.map(u => {
                const days = daysUntil(u.due)
                return (
                  <span key={u.key} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full ${dueCls(days)}`}>
                    <span>{u.icon}</span>
                    <span className="max-w-[220px] truncate">{u.label}</span>
                    <span className="opacity-70">· {dueLabel(days, u.due)}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">

          {/* ── Tasks ── */}
          <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 space-y-4">
            <p className="text-xs font-bold text-[#062E63]">✅ Tasks</p>

            {/* Add */}
            <div className="flex flex-wrap gap-2">
              <input
                value={tTitle}
                onChange={e => setTTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTask() }}
                placeholder="Add a task — Enter to save"
                className="flex-1 min-w-[180px] border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#325099]"
              />
              <input type="date" value={tDue} onChange={e => setTDue(e.target.value)}
                className="border border-[#DEE7FF] rounded-lg px-2.5 py-2 text-xs text-[#062E63] focus:outline-none focus:border-[#325099]" />
              <select value={tWho} onChange={e => setTWho(e.target.value)}
                className="border border-[#DEE7FF] rounded-lg px-2.5 py-2 text-xs bg-white text-[#062E63] focus:outline-none focus:border-[#325099]">
                {ASSIGNEES.map(a => <option key={a}>{a}</option>)}
              </select>
              <button onClick={addTask} disabled={!tTitle.trim()}
                className="text-xs font-semibold bg-[#062E63] text-white px-4 py-2 rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
                Add
              </button>
            </div>

            {/* Open list */}
            {openTasks.length === 0 ? (
              <p className="text-xs text-[#2A2035]/40 py-4 text-center">All clear — nothing open.</p>
            ) : (
              <div className="divide-y divide-[#F0F4FF]">
                {openTasks.map(t => {
                  const days = t.due_date ? daysUntil(t.due_date) : null
                  return (
                    <div key={t.id} className="flex items-center gap-3 py-2.5 group">
                      <input type="checkbox" checked={false} onChange={() => setTaskDone(t, true)}
                        className="accent-[#325099] w-4 h-4 shrink-0 cursor-pointer" title="Mark done" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#2A2035] truncate">{t.title}</p>
                        {t.detail && <p className="text-[11px] text-[#2A2035]/45 truncate">{t.detail}</p>}
                      </div>
                      {t.assignee && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F0F4FF] text-[#325099] shrink-0">{t.assignee}</span>
                      )}
                      {t.due_date && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${dueCls(days)}`}>{dueLabel(days, t.due_date)}</span>
                      )}
                      <button onClick={() => deleteTask(t)} title="Delete"
                        className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition shrink-0">×</button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Done */}
            {doneTasks.length > 0 && (
              <div>
                <button onClick={() => setShowDone(s => !s)}
                  className="text-[11px] font-semibold text-[#325099]/60 hover:text-[#325099]">
                  {showDone ? '− Hide done' : `+ Done (${doneTasks.length} recent)`}
                </button>
                {showDone && (
                  <div className="mt-2 divide-y divide-[#F0F4FF]">
                    {doneTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-3 py-2 group">
                        <input type="checkbox" checked onChange={() => setTaskDone(t, false)}
                          className="accent-[#325099] w-4 h-4 shrink-0 cursor-pointer" title="Reopen" />
                        <p className="text-sm text-[#2A2035]/40 line-through truncate flex-1">{t.title}</p>
                        <span className="text-[10px] text-[#2A2035]/35 shrink-0">{t.done_at ? fmtD(t.done_at.slice(0, 10)) : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Meeting notes — each opens as its own document page ── */}
          <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-[#062E63]">📝 Meeting notes</p>
              <button onClick={newNote} disabled={creatingNote}
                className="text-xs font-semibold bg-[#062E63] text-white px-3.5 py-1.5 rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
                {creatingNote ? 'Opening…' : '+ New note'}
              </button>
            </div>

            {notes.length === 0 ? (
              <p className="text-xs text-[#2A2035]/40 py-4 text-center">No notes yet — start with this week’s meeting.</p>
            ) : (
              <div className="space-y-2">
                {notes.map(n => (
                  <div key={n.id} className="group relative">
                    <Link href={`/tutor/admin/work/notes/${n.id}`}
                      className="block border border-[#DEE7FF] rounded-xl px-3.5 py-2.5 bg-[#F8FAFF] hover:border-[#325099]/50 transition">
                      <p className="text-sm font-semibold text-[#062E63] truncate pr-6">{n.title}</p>
                      <p className="text-[10px] text-[#2A2035]/45">{fmtDLong(n.meeting_date)}</p>
                      {n.body && (
                        <p className="text-[11px] text-[#2A2035]/50 truncate mt-0.5">{htmlToText(n.body).slice(0, 120)}</p>
                      )}
                    </Link>
                    <button onClick={() => deleteNote(n)} title="Delete"
                      className="absolute top-2 right-2.5 opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
