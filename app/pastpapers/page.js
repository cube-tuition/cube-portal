'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import PortalNav from '../../components/PortalNav'
import { T_STUDENTS } from '../../lib/tables'
import { enrolledClassesForTerm } from '../../lib/classes'
import { fetchAllTerms, getCurrentTerm } from '../../lib/terms'
import { inferSubject, subjectsMatch } from '../../components/CourseDetail'

/*
 * Past Paper Tracker — /pastpapers (Years 11–12)
 *
 * One row per paper attempted: year, paper, date, MCQ and written marks (each
 * with its %), and topics to revise. The paper total is the sum of the two
 * sections, so it is derived rather than typed twice. Year is its own field
 * rather than part of the paper's name, so coverage across years is readable at
 * a glance. Students own their rows; staff can read them (RLS).
 *
 * SUBJECT COMES FROM THE TAB — there is no subject field. A paper logged on the
 * Chemistry tab is a Chemistry paper, so a row can never be saved into a tab the
 * student isn't looking at and vanish on them.
 *
 * The tabs are the student's enrolments this term (classes are per-term rows, so
 * the fetch is term-scoped) PLUS any subject already present in their own rows —
 * subjects change between Year 11 and 12, and a paper must never be filed under
 * a tab that no longer exists. With neither to go on, the senior subject list
 * stands in so there is always a tab to log against.
 */

// Stands in only for a student we know nothing about yet — no enrolments this
// term and nothing logged. The first paper they log replaces it with real tabs.
const SUBJECT_FALLBACK = [
  'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Standard Maths',
  'Adv English', 'Standard English', 'Ext 1 English',
  'Chemistry', 'Physics', 'Biology', 'Economics', 'Business Studies', 'Legal Studies',
]

// Defensive bucket: a row saved before subject was tab-driven could have none.
// It keeps such a row visible rather than filtered into nowhere; logging is
// disabled there, because the tab names no subject to log against.
const UNFILED = '__unfiled'

const pct = (m, t) => {
  const mm = Number(m), tt = Number(t)
  if (!Number.isFinite(mm) || !Number.isFinite(tt) || tt <= 0) return null
  return Math.round((mm / tt) * 1000) / 10
}
const pctColor = (p) => (p == null ? '#2A2035' : p >= 80 ? '#047857' : p >= 60 ? '#92400E' : '#B23A3A')
const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const EMPTY_FORM = {
  paper_year: '', paper: '', attempt_date: '',
  mcq_mark: '', mcq_total: '', written_mark: '', written_total: '', notes: '',
}

// A paper's total is its sections added up. Either section may be absent — an
// English paper has no MCQ — so a missing pair contributes nothing rather than
// dragging the total to zero.
// BLANK MEANS ABSENT. Number('') is 0, so a plain Number() here would read an
// empty box as a real zero — a paper with no MCQ section would then count as
// 0/0 rather than being skipped. Used for both form fields and stored rows.
const num = (v) => {
  const s = String(v ?? '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const sectionTotals = (r) => {
  const parts = [[num(r.mcq_mark), num(r.mcq_total)], [num(r.written_mark), num(r.written_total)]]
    .filter(([m, t]) => m != null && t != null && t > 0)
  if (!parts.length) return { mark: num(r.mark), total: num(r.total) }
  return {
    mark: parts.reduce((s, [m]) => s + m, 0),
    total: parts.reduce((s, [, t]) => s + t, 0),
  }
}

const SECTIONS = [['MCQ', 'mcq_mark', 'mcq_total'], ['Written', 'written_mark', 'written_total']]

// A paper can't be from the future. Read at the moment it's needed rather than
// at import, so a tab left open over New Year still caps at the right year.
const thisYear = () => new Date().getFullYear()

/*
 * What a paper must satisfy before it is saved. A mark above its total, or half
 * a section, used to save happily and then skew every average — a half-filled
 * pair simply contributed nothing, silently.
 */
function validate(f) {
  if (!f.paper.trim()) return 'Give the paper a name — e.g. “HSC” or “CSSA Trial”.'
  const y = num(f.paper_year)
  if (y != null && y > thisYear()) return `There is no ${y} paper yet — ${thisYear()} is the latest.`
  for (const [label, mk, tk] of SECTIONS) {
    const m = num(f[mk]), t = num(f[tk])
    if (m != null && t == null) return `${label}: add what it was out of — e.g. ${m}/20.`
    if (m == null && t != null) return `${label}: add the mark you got out of ${t}.`
    if (m == null && t == null) continue
    if (t <= 0) return `${label}: the total has to be more than 0.`
    if (m < 0) return `${label}: a mark can’t be negative.`
    if (m > t) return `${label}: ${m} is more than the total of ${t}.`
  }
  return ''
}

// Marks/totals payload, shared by insert and update. The paper total is kept in
// step with the sections it was built from rather than typed twice.
function markPayload(f) {
  const p = {
    paper: f.paper.trim(),
    paper_year: num(f.paper_year),
    attempt_date: f.attempt_date || null,
    mcq_mark: num(f.mcq_mark),
    mcq_total: num(f.mcq_total),
    written_mark: num(f.written_mark),
    written_total: num(f.written_total),
    notes: f.notes.trim() || null,
  }
  const t = sectionTotals(p)
  return { ...p, mark: t.mark, total: t.total }
}

const byRecency = (a, b) => (
  String(b.attempt_date || '').localeCompare(String(a.attempt_date || ''))
  || (b.paper_year || 0) - (a.paper_year || 0)
)

const INPUT = 'border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] w-full'

/*
 * The fields of one paper. Shared by "Log a paper" and by editing an existing
 * row, so the two can never drift apart — and so the edit form is the same
 * stacked layout on a phone as it is on a laptop.
 */
function PaperFields({ value, onChange, onSubmit }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  const setNum = (k) => (e) => onChange({ ...value, [k]: e.target.value.replace(/[^\d.]/g, '') })
  const enterSubmits = (e) => { if (e.key === 'Enter') onSubmit?.() }
  // A future paper year is refused as it is typed rather than at save time.
  // Refusing silently reads as a broken keyboard, so say why; the note clears
  // as soon as an accepted digit lands.
  const [futureYear, setFutureYear] = useState(false)
  const setYear = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
    // Only a COMPLETE year can be judged — "202" on the way to "2025" is fine.
    if (digits.length === 4 && Number(digits) > thisYear()) { setFutureYear(true); return }
    setFutureYear(false)
    onChange({ ...value, paper_year: digits })
  }
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-[90px_1.4fr_1fr] gap-2">
        <input className={INPUT} placeholder="Year" inputMode="numeric" maxLength={4} aria-label="Paper year"
          value={value.paper_year} onKeyDown={enterSubmits} onChange={setYear}
          aria-invalid={futureYear || undefined} title={`Any year up to ${thisYear()}`} />
        <input className={INPUT} placeholder="Paper — e.g. HSC" aria-label="Paper name"
          value={value.paper} onChange={set('paper')} onKeyDown={enterSubmits} />
        <input className={INPUT} type="date" aria-label="Date attempted"
          value={value.attempt_date} onChange={set('attempt_date')} onKeyDown={enterSubmits} />
      </div>
      {futureYear && (
        <p className="text-[11px] text-[#B23A3A] mt-1">That paper doesn’t exist yet — {thisYear()} is the latest year you can enter.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        {SECTIONS.map(([label, mk, tk]) => {
          const p = pct(value[mk], value[tk])
          return (
            <div key={label} className="flex items-center gap-2 rounded-lg border border-[#EEF2FB] bg-[#F8FAFF] px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/70 w-14 shrink-0">{label}</span>
              <input className={`${INPUT} w-16`} placeholder="Mark" inputMode="decimal" aria-label={`${label} mark`}
                value={value[mk]} onChange={setNum(mk)} onKeyDown={enterSubmits} />
              <span className="text-[#2A2035]/35">/</span>
              <input className={`${INPUT} w-16`} placeholder="Total" inputMode="decimal" aria-label={`${label} total`}
                value={value[tk]} onChange={setNum(tk)} onKeyDown={enterSubmits} />
              <span className="text-[11px] font-bold tabular-nums ml-auto" style={{ color: pctColor(p) }}>
                {p != null ? `${p}%` : ''}
              </span>
            </div>
          )
        })}
      </div>
      <input className={`${INPUT} mt-2`} placeholder="Topics to revise / notes" aria-label="Topics to revise"
        value={value.notes} onChange={set('notes')} onKeyDown={enterSubmits} />
    </>
  )
}

// A section cell: raw marks with its own percentage beside them. A paper with
// no such section (English has no MCQ) shows a dash rather than 0%.
function SectionCell({ mark, total, bold = false }) {
  const p = pct(mark, total)
  if (mark == null || total == null) return <span className="text-[#2A2035]/30">—</span>
  return (
    <span className="whitespace-nowrap">
      <span className={`tabular-nums ${bold ? 'font-bold text-[#062E63]' : ''}`}>{mark}/{total}</span>
      {p != null && (
        <span className="ml-1.5 text-[11px] font-bold tabular-nums" style={{ color: pctColor(p) }}>{p}%</span>
      )}
    </span>
  )
}

// The running paper total under the fields, so the sum is visible before saving.
function RunningTotal({ form }) {
  const t = sectionTotals(form)
  const p = pct(t.mark, t.total)
  if (p == null) return null
  return (
    <p className="text-[11px] mt-1.5 font-semibold" style={{ color: pctColor(p) }}>
      Paper total: {t.mark}/{t.total} = {p}%
    </p>
  )
}

export default function PastPapersPage() {
  const router = useRouter()
  const [student, setStudent] = useState(null)
  const [year, setYear] = useState(null)
  const [rows, setRows] = useState(null)          // null = loading
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')              // add form
  const [editErr, setEditErr] = useState('')      // edit form
  const [enrolled, setEnrolled] = useState([])    // enrolled subjects, this term
  const [picked, setPicked] = useState('')      // the tab the student clicked
  const [confirmDelete, setConfirmDelete] = useState(null)   // row id awaiting a second click

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!requireStudent(user, router)) return
      const { data: s } = await supabase.from(T_STUDENTS)
        .select('id, full_name, year').eq('id', user.id).maybeSingle()
      setStudent(s || { id: user.id, full_name: '' })
      setYear(String(s?.year ?? ''))
      const { data: at } = await supabase.from('past_paper_attempts')
        .select('*').eq('student_id', user.id)
        .order('attempt_date', { ascending: false, nullsFirst: false })
      setRows(at || [])

      // Enrolments this term. Classes are per-term rows, so this must be
      // term-scoped or every class appears once per term it has ever run.
      const terms = await fetchAllTerms()
      const cur = getCurrentTerm(terms)
      if (cur) {
        const { data: cls } = await enrolledClassesForTerm(
          user.id, cur.id, 'id, class_name').eq('status', 'active')
        const names = (cls || []).map(c => c.classes).filter(Boolean)
        setEnrolled([...new Set(names.map(c => inferSubject(c)).filter(Boolean))].sort())
      }
    })()
  }, [router])

  const senior = year === '11' || year === '12'
  const inSubject = (r, sub) => subjectsMatch(r.subject || '', sub)

  /*
   * The tabs. Enrolments first (the subjects they're taught here), then any
   * subject their own rows carry that no enrolment covers — a Year 12 keeps the
   * tab for a paper logged in Year 11. Neither is a reason for a row to hide.
   */
  const subjects = useMemo(() => {
    const extra = []
    for (const r of rows || []) {
      const s = (r.subject || '').trim()
      if (!s) continue
      if (enrolled.some(e => subjectsMatch(s, e))) continue
      if (extra.some(e => subjectsMatch(s, e))) continue
      extra.push(s)
    }
    const all = [...enrolled, ...extra.sort()]
    return all.length ? all : SUBJECT_FALLBACK
  }, [enrolled, rows])

  // A row with no subject at all can't belong to any tab; give it one so it
  // stays reachable. (Subject is set from the tab on save, so this is legacy-only.)
  const hasUnfiled = useMemo(() => (rows || []).some(r => !(r.subject || '').trim()), [rows])
  const tabs = useMemo(
    () => [...subjects.map(s => [s, s]), ...(hasUnfiled ? [[UNFILED, 'Unfiled']] : [])],
    [subjects, hasUnfiled])

  // The active tab is DERIVED, not stored: a tab the student picked stays picked
  // while it exists, and otherwise the first one wins. Syncing it in an effect
  // would mean a render with a tab that isn't in the list.
  const subTab = useMemo(
    () => (picked && tabs.some(([v]) => v === picked) ? picked : (tabs[0]?.[0] ?? '')),
    [picked, tabs])

  const countIn = (v) => (rows || []).filter(
    r => (v === UNFILED ? !(r.subject || '').trim() : inSubject(r, v))).length

  const visible = useMemo(() => {
    if (!subTab) return rows || []
    if (subTab === UNFILED) return (rows || []).filter(r => !(r.subject || '').trim())
    return (rows || []).filter(r => inSubject(r, subTab))
  }, [rows, subTab])

  // Averages are of the per-paper percentages, so a 100-mark paper doesn't
  // outweigh a 20-mark one. Each is counted only over papers that have that
  // section — the MCQ average ignores English papers entirely.
  const stats = useMemo(() => {
    if (!visible?.length) return null
    const mean = (list) => (list.length
      ? Math.round(list.reduce((s, p) => s + p, 0) / list.length * 10) / 10 : null)
    const totals = visible.map(r => { const t = sectionTotals(r); return pct(t.mark, t.total) }).filter(p => p != null)
    const mcq = visible.map(r => pct(r.mcq_mark, r.mcq_total)).filter(p => p != null)
    const written = visible.map(r => pct(r.written_mark, r.written_total)).filter(p => p != null)
    return {
      n: visible.length,
      avg: mean(totals), avgN: totals.length,
      mcqAvg: mean(mcq), mcqN: mcq.length,
      writtenAvg: mean(written), writtenN: written.length,
      best: totals.length ? Math.max(...totals) : null,
      last: visible.find(r => r.attempt_date)?.attempt_date ?? null,
    }
  }, [visible])

  const canLog = !!subTab && subTab !== UNFILED

  const addRow = async () => {
    const problem = validate(form)
    if (problem) { setErr(problem); return }
    setSaving(true); setErr('')
    // The tab IS the subject — there is no field to disagree with it.
    const { data, error } = await supabase.from('past_paper_attempts')
      .insert({ student_id: student.id, subject: subTab, ...markPayload(form) })
      .select('*').single()
    if (error) setErr('Could not save: ' + error.message)
    else {
      setRows(rs => [data, ...rs].sort(byRecency))
      setForm(EMPTY_FORM)
    }
    setSaving(false)
  }

  const startEdit = (r) => {
    setEditErr('')
    setEditingId(r.id)
    setEditForm({
      paper_year: r.paper_year ?? '', paper: r.paper || '',
      attempt_date: r.attempt_date || '',
      mcq_mark: r.mcq_mark ?? '', mcq_total: r.mcq_total ?? '',
      written_mark: r.written_mark ?? '', written_total: r.written_total ?? '',
      notes: r.notes || '',
    })
  }

  const saveEdit = async () => {
    const problem = validate(editForm)
    if (problem) { setEditErr(problem); return }
    setSaving(true); setEditErr('')
    const payload = { ...markPayload(editForm), updated_at: new Date().toISOString() }
    const { error } = await supabase.from('past_paper_attempts').update(payload).eq('id', editingId)
    setSaving(false)
    // A failed save keeps the editor open with the message — closing it as if
    // it had worked is how an edit silently disappeared.
    if (error) { setEditErr('Could not save: ' + error.message); return }
    setRows(rs => rs.map(r => (r.id === editingId ? { ...r, ...payload } : r)).sort(byRecency))
    setEditingId(null)
  }

  // Two clicks to delete: the ✕ arms, a second click removes. Same pattern as
  // the staff topic bank, and it needs no browser dialog.
  const removeRow = async (id) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    setConfirmDelete(null)
    const { error } = await supabase.from('past_paper_attempts').delete().eq('id', id)
    if (error) { setErr('Could not delete: ' + error.message); return }
    setRows(rs => rs.filter(r => r.id !== id))
  }

  // Called, not instantiated — see the note above renderEditPanel.
  const renderRowActions = (r) => (
    <span className="whitespace-nowrap">
      <button aria-label={`Edit ${r.paper}`} title="Edit"
        className="text-[11px] font-semibold text-[#325099]/70 hover:text-[#325099] mr-3"
        onClick={() => startEdit(r)}>Edit</button>
      <button aria-label={confirmDelete === r.id ? `Confirm delete ${r.paper}` : `Delete ${r.paper}`}
        title={confirmDelete === r.id ? 'Click again to delete' : 'Delete'}
        className={`text-[11px] font-semibold ${confirmDelete === r.id ? 'text-[#B23A3A]' : 'text-[#2A2035]/40 hover:text-[#B23A3A]'}`}
        onClick={() => removeRow(r.id)}
        onBlur={() => setConfirmDelete(c => (c === r.id ? null : c))}>
        {confirmDelete === r.id ? 'Confirm?' : 'Delete'}
      </button>
    </span>
  )

  /*
   * Rendered by CALLING this, never as <EditPanel/>. A component declared inside
   * another component is a new function on every render, so React unmounts and
   * remounts its whole subtree — which would destroy the focused input after
   * every single keystroke in this form. Calling it inlines the elements, and
   * reconciliation matches them by position as usual.
   */
  const renderEditPanel = () => (
    <div className="bg-[#F8FAFF] rounded-xl border border-[#DEE7FF] p-3">
      <PaperFields value={editForm} onChange={setEditForm} onSubmit={saveEdit} />
      <RunningTotal form={editForm} />
      {editErr && <p className="text-xs text-[#B23A3A] mt-2">{editErr}</p>}
      <div className="flex gap-2 mt-2">
        <button onClick={saveEdit} disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-[#325099] text-white text-xs font-semibold hover:bg-[#062E63] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setEditingId(null); setEditErr('') }}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035]">Cancel</button>
      </div>
    </div>
  )

  if (!student || rows === null) return (
    <div className="min-h-screen flex items-center justify-center bg-white text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  )

  if (!senior) return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav studentName={student.full_name} />
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <div className="text-4xl mb-3">📄</div>
        <h1 className="text-xl font-bold text-[#2A2035] font-display mb-2">Past Paper Tracker</h1>
        <p className="text-sm text-[#2A2035]/60">This page is for Year 11 and 12 students preparing for trials and the HSC.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav studentName={student.full_name} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-10 py-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">Year {year}</p>
        <h1 className="text-2xl font-bold text-[#2A2035] font-display mb-6">Past Paper Tracker</h1>

        {tabs.length > 0 && (
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {tabs.map(([v, label]) => {
              const on = subTab === v
              return (
                <button key={v} onClick={() => setPicked(v)} aria-pressed={on}
                  className={`px-3.5 py-1.5 rounded-xl border text-sm font-semibold transition ${on
                    ? 'bg-[#DEE7FF] text-[#062E63] border-[#BACBFF]'
                    : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}>
                  {label}
                  <span className={`ml-1.5 text-[10px] font-bold ${on ? 'text-[#325099]' : 'text-[#2A2035]/35'}`}>{countIn(v)}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Averages, with the count / best / last as a caption rather than three
            more tiles — this table usually holds a handful of rows. */}
        {stats && (
          <div className="mb-6">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                ['Average total', stats.avg, stats.avgN, 'whole papers'],
                ['Average MCQ', stats.mcqAvg, stats.mcqN, 'multiple choice'],
                ['Average written', stats.writtenAvg, stats.writtenN, 'short + extended'],
              ].map(([l, v, n, sub]) => (
                <div key={l} className="bg-white rounded-2xl border border-[#DEE7FF] px-3 sm:px-4 py-3">
                  <p className="text-[9px] tracking-[0.14em] uppercase text-[#325099]/60 font-bold">{l}</p>
                  <p className="text-2xl sm:text-3xl font-bold mt-0.5 font-display" style={{ color: pctColor(v) }}>
                    {v != null ? `${v}%` : '—'}
                  </p>
                  <p className="text-[10px] text-[#2A2035]/45">
                    {v != null ? `${sub} · ${n} paper${n === 1 ? '' : 's'}` : `no ${sub} logged yet`}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#2A2035]/50 mt-2">
              <span className="font-semibold text-[#062E63]">{stats.n} paper{stats.n === 1 ? '' : 's'}</span> in {subTab === UNFILED ? 'Unfiled' : subTab}
              {stats.best != null && <> · best <span className="font-semibold text-[#047857]">{stats.best}%</span></>}
              {stats.last && <> · last attempt {fmtDate(stats.last)}</>}
            </p>
          </div>
        )}

        {/* Log a paper — the subject is the tab, so there is no subject field. */}
        {canLog && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-4 mb-6">
            <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-bold mb-3">
              ＋ Log a {subTab} paper
            </p>
            <PaperFields value={form} onChange={setForm} onSubmit={addRow} />
            <RunningTotal form={form} />
            {err && <p className="text-xs text-[#B23A3A] mt-2">{err}</p>}
            <button onClick={addRow} disabled={saving}
              className="mt-3 px-5 py-1.5 rounded-lg bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
              {saving ? 'Saving…' : 'Add paper'}
            </button>
          </div>
        )}
        {subTab === UNFILED && (
          <p className="bg-white rounded-2xl border border-[#DEE7FF] p-4 mb-6 text-xs text-[#2A2035]/55">
            These papers were logged without a subject. Pick a subject tab above to log a new one.
          </p>
        )}

        {/* The tracker — a table on a laptop, cards on a phone. */}
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
          {/* Desktop */}
          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="text-left text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 border-b border-[#EEF2FB]">
                {['Year', 'Paper', 'Date', 'MCQ', 'Written', 'Total', 'Topics to revise', ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (editingId === r.id ? (
                <tr key={r.id} className="border-b border-[#F4F7FF]">
                  <td colSpan={8} className="px-3 py-3">{renderEditPanel()}</td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-[#F4F7FF] last:border-0">
                  <td className="px-4 py-2.5 tabular-nums font-semibold text-[#062E63]">{r.paper_year || <span className="text-[#2A2035]/30">—</span>}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#2A2035]">{r.paper}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(r.attempt_date)}</td>
                  <td className="px-4 py-2.5"><SectionCell mark={r.mcq_mark} total={r.mcq_total} /></td>
                  <td className="px-4 py-2.5"><SectionCell mark={r.written_mark} total={r.written_total} /></td>
                  <td className="px-4 py-2.5"><SectionCell {...sectionTotals(r)} bold /></td>
                  <td className="px-4 py-2.5 text-[#2A2035]/70">{r.notes || <span className="text-[#2A2035]/30">—</span>}</td>
                  <td className="px-4 py-2.5 text-right">{renderRowActions(r)}</td>
                </tr>
              )))}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-[#2A2035]/45">
                  Nothing logged for {subTab === UNFILED ? 'unfiled papers' : subTab} yet — add your first paper above.
                </td></tr>
              )}
            </tbody>
          </table>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-[#F4F7FF]">
            {visible.map(r => (editingId === r.id ? (
              <div key={r.id} className="p-3">{renderEditPanel()}</div>
            ) : (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-[#2A2035] text-sm">
                    {r.paper_year ? <span className="tabular-nums text-[#062E63]">{r.paper_year} </span> : null}{r.paper}
                  </p>
                  <span className="text-[11px] text-[#2A2035]/45 whitespace-nowrap">{fmtDate(r.attempt_date)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs">
                  <span><span className="text-[9px] font-bold uppercase tracking-wider text-[#325099]/60 mr-1">MCQ</span><SectionCell mark={r.mcq_mark} total={r.mcq_total} /></span>
                  <span><span className="text-[9px] font-bold uppercase tracking-wider text-[#325099]/60 mr-1">Written</span><SectionCell mark={r.written_mark} total={r.written_total} /></span>
                  <span><span className="text-[9px] font-bold uppercase tracking-wider text-[#325099]/60 mr-1">Total</span><SectionCell {...sectionTotals(r)} bold /></span>
                </div>
                {r.notes && <p className="text-xs text-[#2A2035]/70 mt-1.5">{r.notes}</p>}
                <div className="mt-2">{renderRowActions(r)}</div>
              </div>
            )))}
            {visible.length === 0 && (
              <p className="px-4 py-10 text-center text-xs text-[#2A2035]/45">
                Nothing logged for {subTab === UNFILED ? 'unfiled papers' : subTab} yet — add your first paper above.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
