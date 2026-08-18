'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { allFlags, reasonMeta, resolveFlag, reopenFlag, flagSeverity, FLAG_REASONS } from '../../../lib/studentFlags'

/*
 * Student flags — /tutor/flags
 * Every flag a tutor has raised from a lesson page, open ones first. The
 * Action Centre links here and can resolve a flag inline; this page adds the
 * history — what was raised before, about whom, and what was done about it.
 */

const fmtWhen = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
const fmtDate = (d) => {
  if (!d) return ''
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) }
  catch { return String(d) }
}

export default function FlagsPage() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('open')      // open | resolved | all
  const [reason, setReason] = useState('All')
  const [busy, setBusy] = useState(null)        // id being written
  const [resolving, setResolving] = useState(null)  // { id } — the note prompt
  const [note, setNote] = useState('')

  async function load() {
    setLoading(true)
    try { setFlags(await allFlags()) }
    catch (e) { setError(e.message || 'Could not load flags') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setStaff(profile)
      load()
    })()
  }, [router])

  const visible = useMemo(() => flags.filter(f =>
    (view === 'all' || f.status === view) && (reason === 'All' || f.reason === reason)
  ), [flags, view, reason])

  const openCount = flags.filter(f => f.status === 'open').length
  // Repeat flags are the real signal — three "homework" flags in a term is a
  // conversation with the family, not three separate notes.
  const perStudent = useMemo(() => {
    const m = {}
    for (const f of flags) m[f.student_id] = (m[f.student_id] || 0) + 1
    return m
  }, [flags])

  async function doResolve(id) {
    setBusy(id)
    try { await resolveFlag(id, { resolution: note, staff }); setResolving(null); setNote(''); await load() }
    catch (e) { setError(e.message) }
    finally { setBusy(null) }
  }
  async function doReopen(id) {
    setBusy(id)
    try { await reopenFlag(id); await load() }
    catch (e) { setError(e.message) }
    finally { setBusy(null) }
  }

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF]" />

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin />
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-20">
        <Link href="/tutor" className="text-xs text-[#325099] hover:underline">← Home</Link>
        <div className="flex items-end justify-between gap-4 mt-1 mb-6 flex-wrap">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">Students</p>
            <h1 className="text-2xl font-bold text-[#062E63]">🚩 Student flags</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Concerns raised by tutors from the lesson page. Resolving one keeps it on the student&rsquo;s record.
            </p>
          </div>
          {openCount > 0 && (
            <span className="text-[10px] tracking-widest uppercase font-semibold text-[#B23A3A]">{openCount} open</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="inline-flex rounded-lg border border-[#DEE7FF] overflow-hidden text-xs font-semibold">
            {[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`px-3.5 py-1.5 transition ${view === v ? 'bg-[#325099] text-white' : 'bg-white text-[#2A2035]/60 hover:bg-[#F8FAFF]'}`}>
                {lbl}
              </button>
            ))}
          </div>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="text-xs font-semibold text-[#2A2035] bg-white border border-[#DEE7FF] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#325099]">
            <option value="All">All reasons</option>
            {FLAG_REASONS.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
          </select>
          <button onClick={load} disabled={loading}
            className="text-[11px] font-semibold text-[#325099] hover:underline disabled:opacity-40 ml-auto">
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {error && <p className="mb-3 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">{error}</p>}

        {loading && flags.length === 0 ? (
          <p className="text-sm text-[#2A2035]/50 animate-pulse py-10 text-center">Loading flags…</p>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-12 text-center">
            <div className="text-4xl mb-2">{view === 'open' ? '✅' : '🚩'}</div>
            <p className="text-sm font-semibold text-[#2A2035]">
              {view === 'open' ? 'No open flags.' : 'Nothing here yet.'}
            </p>
            <p className="text-xs text-[#2A2035]/50 mt-1">
              Tutors raise flags from the roster on a lesson page.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(f => {
              const meta = reasonMeta(f.reason)
              const open = f.status === 'open'
              const sev = open ? flagSeverity(f) : 'blue'
              const repeats = perStudent[f.student_id] || 1
              return (
                <div key={f.id}
                  className={`rounded-xl px-4 py-3 border transition ${
                    !open ? 'border-[#DEE7FF] bg-white/60'
                      : sev === 'red' ? 'border-[#FDE8E8] bg-[#FFF5F5]' : 'border-[#FDE68A] bg-[#FFFBEB]'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-1 h-10 rounded-full shrink-0 mt-0.5 ${
                      !open ? 'bg-[#CBD5E1]' : sev === 'red' ? 'bg-[#B23A3A]' : 'bg-[#D97706]'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm text-[#2A2035]">{f.student_name}</p>
                        <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-white/70 border border-[#DEE7FF] text-[#325099]">
                          {meta.icon} {meta.label}
                        </span>
                        {!open && (
                          <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">resolved</span>
                        )}
                        {repeats > 1 && (
                          <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#EEF4FF] text-[#062E63] border border-[#DEE7FF]"
                                title="Total flags on this student">×{repeats}</span>
                        )}
                      </div>
                      {f.note && <p className="text-xs text-[#2A2035]/75 mt-1 whitespace-pre-wrap">{f.note}</p>}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-[#2A2035]/50">
                        {f.class_name && <span>{f.class_name}</span>}
                        {f.lesson_date && <span>📅 {fmtDate(f.lesson_date)}</span>}
                        {f.raised_by_name && <span>👤 {f.raised_by_name}</span>}
                        <span>🕐 {fmtWhen(f.created_at)}</span>
                      </div>
                      {!open && (f.resolution || f.resolved_by_name) && (
                        <p className="text-[11px] text-emerald-800/80 mt-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
                          ✓ {f.resolution || 'Resolved'}
                          {f.resolved_by_name ? ` — ${f.resolved_by_name}` : ''}
                          {f.resolved_at ? `, ${fmtWhen(f.resolved_at)}` : ''}
                        </p>
                      )}
                    </div>
                    {open ? (
                      <button onClick={() => { setResolving({ id: f.id }); setNote('') }} disabled={busy === f.id}
                        className="text-[10px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 rounded-full hover:bg-emerald-100 transition shrink-0 disabled:opacity-40">
                        ✓ Resolve
                      </button>
                    ) : (
                      <button onClick={() => doReopen(f.id)} disabled={busy === f.id}
                        className="text-[10px] font-semibold text-[#325099] border border-[#DEE7FF] bg-white px-2.5 py-1.5 rounded-full hover:bg-[#F8FAFF] transition shrink-0 disabled:opacity-40">
                        Reopen
                      </button>
                    )}
                  </div>

                  {resolving?.id === f.id && (
                    <div className="mt-3 pl-4 border-l-2 border-emerald-200">
                      <label className="block text-[11px] font-bold text-[#062E63] mb-1">What was done about it? <span className="font-normal text-[#2A2035]/45">(optional)</span></label>
                      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus
                        placeholder="e.g. Called mum — she'll check homework nightly."
                        className="w-full rounded-lg border border-[#DEE7FF] px-2.5 py-2 text-xs text-[#2A2035] focus:outline-none focus:ring-2 focus:ring-emerald-300/40" />
                      <div className="flex justify-end gap-2 mt-2">
                        <button onClick={() => { setResolving(null); setNote('') }}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#2A2035]/60 hover:bg-white">Cancel</button>
                        <button onClick={() => doResolve(f.id)} disabled={busy === f.id}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition disabled:opacity-40">
                          {busy === f.id ? 'Saving…' : 'Resolve flag'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
