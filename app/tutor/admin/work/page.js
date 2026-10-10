'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { daysUntil } from '../../../../lib/complianceDates'
import { htmlToText } from '../../../../lib/richNotes'
import { authedFetch } from '../../../../lib/authedFetch'

/*
 * The recurring automation schedule — the human-readable face of
 * vercel.json's crons plus the rules inside /api/reminders/daily. Kept here
 * by hand: if a cron is added or retimed there, update this list.
 * Times are Sydney (the UTC crons land an hour later during DST).
 */
const RECURRING = [
  {
    icon: '📲', title: 'Daily reminders push', when: 'Every morning · ~7–8am',
    detail: 'To the directors\' iPhones. Bank payroll — the Monday after each term fortnight, with the total. Cash payroll — each cash teacher\'s chosen weekday in the fortnight\'s last week. Compliance (BAS, company tax, ASIC) — a week before and the day before, unless ticked off. Term start — the day before.',
  },
  {
    icon: '🔄', title: 'Xero payroll reconcile', when: 'Every morning · ~6–7am',
    detail: 'Pulls posted pay runs back from Xero: posted runs flip their shifts and portal pay runs to paid, so the books agree before the day starts.',
  },
  {
    icon: '🗄️', title: 'Data syncs', when: 'Every night · ~12–1am',
    detail: 'Students, classes, quizzes and booklets sync jobs.',
  },
]

/*
 * Work — /tutor/admin/work (directors only)
 *
 * The directors' work centre: the running to-do between Ryan and Aiden
 * (ops_tasks — add, assign, tick off) and CUBE notes (work_notes).
 * Compliance due dates live on the Accounting dashboard, not here.
 */

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
  const [error, setError]     = useState(null)

  // Task add form
  const [tTitle, setTTitle]   = useState('')
  const [tDue, setTDue]       = useState('')
  const [tWho, setTWho]       = useState('Both')
  const [showDone, setShowDone] = useState(false)

  const [creatingNote, setCreatingNote] = useState(false)
  const [pushes, setPushes] = useState(null)   // null = loading; [{date,title,body}] otherwise

  const load = useCallback(async () => {
    const [t, n] = await Promise.all([
      supabase.from('ops_tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('work_notes').select('*').order('meeting_date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    if (t.error) setError(`Tasks failed to load: ${t.error.message}`)
    if (n.error) setError(`Notes failed to load: ${n.error.message}`)
    setTasks(t.data || [])
    setNotes(n.data || [])
    // What the phones will actually buzz about — straight from the reminder
    // engine's own preview, so this list can never drift from what sends.
    authedFetch('/api/reminders/daily?preview=14')
      .then(r => r.json()).then(j => setPushes(j.upcoming || []))
      .catch(() => setPushes([]))
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

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const openTasks = useMemo(() =>
    tasks.filter(t => t.status !== 'done').sort((a, b) =>
      (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.created_at || '').localeCompare(b.created_at || '')),
    [tasks])
  // One column per person: a task with no assignee (or anyone else) is for both.
  const TASK_COLUMNS = ['Both', 'Aiden', 'Ryan']
  const columnOf = (t) => (t.assignee === 'Aiden' || t.assignee === 'Ryan' ? t.assignee : 'Both')
  const titleInput = useRef(null)
  // The add bar stays hidden until a column's + Add asks for it.
  const [adding, setAdding] = useState(false)
  const addTo = (who) => {
    setTWho(who); setAdding(true)
    setTimeout(() => titleInput.current?.focus(), 0)
  }
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
          <h1 className="text-2xl font-bold text-[#062E63]">Operations</h1>
          <p className="text-sm text-[#325099]/60 mt-0.5">The running to-do between directors, and CUBE notes</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">×</button>
          </div>
        )}

        {/* ── Tasks ── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 space-y-4">
          <p className="text-xs font-bold text-[#062E63]">✅ Tasks</p>

          {/* Add — appears only when a column's + Add asks for it */}
          {adding && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={titleInput}
                value={tTitle}
                onChange={e => setTTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addTask()
                  if (e.key === 'Escape') { setAdding(false); setTTitle('') }
                }}
                placeholder="Add a task — Enter to save, Esc to close"
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
              <button onClick={() => { setAdding(false); setTTitle('') }} title="Close"
                className="text-xs font-semibold text-[#2A2035]/40 hover:text-[#2A2035] px-2">×</button>
            </div>
          )}

          {/* Open tasks — a column each for both directors, Aiden and Ryan */}
          <div className="grid md:grid-cols-3 gap-3">
            {TASK_COLUMNS.map(col => {
              const list = openTasks.filter(t => columnOf(t) === col)
              return (
                <div key={col} className="rounded-xl border border-[#E4EAFB] bg-[#F8FAFF] p-3 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-bold text-[#062E63] uppercase tracking-wider">
                      {col} <span className="text-[#325099]/50 font-semibold normal-case tracking-normal">· {list.length}</span>
                    </p>
                    <button onClick={() => addTo(col)} title={`Add a task for ${col === 'Both' ? 'both of you' : col}`}
                      className="text-[11px] font-semibold text-[#325099]/60 hover:text-[#325099]">+ Add</button>
                  </div>
                  {list.length === 0 ? (
                    <p className="text-[11px] text-[#2A2035]/35 py-3 text-center">Nothing open</p>
                  ) : (
                    <div className="divide-y divide-[#E8EDF8]">
                      {list.map(t => {
                        const days = t.due_date ? daysUntil(t.due_date) : null
                        return (
                          <div key={t.id} className="flex items-start gap-2.5 py-2 group">
                            <input type="checkbox" checked={false} onChange={() => setTaskDone(t, true)}
                              className="accent-[#325099] w-4 h-4 mt-0.5 shrink-0 cursor-pointer" title="Mark done" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-[#2A2035] break-words">{t.title}</p>
                              {t.detail && <p className="text-[11px] text-[#2A2035]/45 break-words">{t.detail}</p>}
                              {t.due_date && (
                                <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${dueCls(days)}`}>{dueLabel(days, t.due_date)}</span>
                              )}
                            </div>
                            <button onClick={() => deleteTask(t)} title="Delete"
                              className="md:opacity-0 md:group-hover:opacity-100 text-red-300 hover:text-red-500 transition shrink-0">×</button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

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
                      <span className="text-[10px] text-[#2A2035]/35 shrink-0">{columnOf(t)}</span>
                      <span className="text-[10px] text-[#2A2035]/35 shrink-0">{t.done_at ? fmtD(t.done_at.slice(0, 10)) : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── CUBE notes (work_notes) — each opens as its own document page ── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#062E63]">📝 CUBE notes</p>
            <button onClick={newNote} disabled={creatingNote}
              className="text-xs font-semibold bg-[#062E63] text-white px-3.5 py-1.5 rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
              {creatingNote ? 'Opening…' : '+ New note'}
            </button>
          </div>

          {notes.length === 0 ? (
            <p className="text-xs text-[#2A2035]/40 py-4 text-center">No CUBE notes yet.</p>
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

        {/* ── Notification centre ── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <p className="text-xs font-bold text-[#062E63] mb-4">🔔 Notifications</p>
          <div className="grid md:grid-cols-2 gap-6 items-start">

            {/* Live: the next fortnight of pushes, from the reminder engine itself */}
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#325099]/55 mb-2">Coming to your phone · next 14 days</p>
              {pushes === null ? (
                <p className="text-xs text-[#2A2035]/40 py-3">Loading…</p>
              ) : pushes.length === 0 ? (
                <p className="text-xs text-[#2A2035]/40 py-3">Nothing scheduled to push in the next fortnight.</p>
              ) : (
                <div className="space-y-1.5">
                  {pushes.map((p, i) => {
                    const days = daysUntil(p.date)
                    return (
                      <div key={i} className="flex items-start gap-2.5 text-xs" title={p.body || ''}>
                        <span className={`shrink-0 mt-[1px] text-[10px] font-semibold px-2 py-0.5 rounded-full ${dueCls(days)}`}>
                          {days === 0 ? 'today' : days === 1 ? 'tomorrow' : fmtD(p.date)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[#2A2035] font-medium truncate">{p.title}</p>
                          {p.body && <p className="text-[11px] text-[#2A2035]/50 truncate">{p.body}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* The standing schedule */}
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#325099]/55 mb-2">Recurring schedule</p>
              <div className="space-y-3">
                {RECURRING.map(r => (
                  <div key={r.title} className="flex items-start gap-2.5">
                    <span className="text-base leading-none mt-0.5 shrink-0">{r.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#062E63]">
                        {r.title} <span className="font-normal text-[#325099]/60">· {r.when}</span>
                      </p>
                      <p className="text-[11px] text-[#2A2035]/55 leading-relaxed">{r.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
