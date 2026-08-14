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
 * One row per paper attempted: year, paper, subject, date, MCQ and written
 * marks (each with its %), and topics to revise. The paper total is the sum of
 * the two sections, so it is derived rather than typed twice. Year is its own field rather than part
 * of the paper's name, so coverage across years is readable at a glance. Students own their rows; staff can read them (RLS).
 * Until the student adds anything, greyed example rows show how it's used.
 *
 * Subject tabs — and the subject dropdown — come from the student's own
 * enrolments this term (classes are per-term rows, so the fetch is
 * term-scoped). An "Other" tab appears only if some logged papers match none
 * of them, so no row is ever invisible. The field stays free-text: a student
 * sitting a paper for a subject they don't take here can still log it.
 */

// Fallback only — used when a student has no current enrolments to offer.
const SUBJECT_SUGGESTIONS = [
  'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Standard Maths',
  'Adv English', 'Standard English', 'Ext 1 English',
  'Chemistry', 'Physics', 'Biology', 'Economics', 'Business Studies', 'Legal Studies',
]

// Shown greyed-out while the tracker is empty — a template, not saved data.
const EXAMPLES = [
  { paper_year: 2023, paper: 'HSC', subject: 'Adv Maths', attempt_date: '2026-07-02',
    mcq_mark: 8, mcq_total: 10, written_mark: 63, written_total: 90,
    notes: 'Projectile motion Q31; financial maths tables' },
  { paper_year: 2022, paper: 'HSC', subject: 'Chemistry', attempt_date: '2026-07-15',
    mcq_mark: 13, mcq_total: 20, written_mark: 51, written_total: 80,
    notes: 'Redo titration calculations; equilibrium graphs' },
  { paper_year: 2024, paper: 'CSSA Trial', subject: 'Adv English', attempt_date: '2026-07-29',
    mcq_mark: null, mcq_total: null, written_mark: 15, written_total: 20,
    notes: 'Module B essay — tighten thesis paragraph' },
]

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
  paper_year: '', paper: '', subject: '', attempt_date: '',
  mcq_mark: '', mcq_total: '', written_mark: '', written_total: '', notes: '',
}

// A paper's total is its sections added up. Either section may be absent — an
// English paper has no MCQ — so a missing pair contributes nothing rather than
// dragging the total to zero.
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const sectionTotals = (r) => {
  const parts = [[num(r.mcq_mark), num(r.mcq_total)], [num(r.written_mark), num(r.written_total)]]
    .filter(([m, t]) => m != null && t != null && t > 0)
  if (!parts.length) return { mark: num(r.mark), total: num(r.total) }
  return {
    mark: parts.reduce((s, [m]) => s + m, 0),
    total: parts.reduce((s, [, t]) => s + t, 0),
  }
}

export default function PastPapersPage() {
  const router = useRouter()
  const [student, setStudent] = useState(null)
  const [year, setYear] = useState(null)
  const [rows, setRows] = useState(null)        // null = loading
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [subjects, setSubjects] = useState([])   // enrolled subjects, this term
  const [subTab, setSubTab] = useState('')   // '' only while there are no tabs to pick

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

      // Subject tabs = what they're actually enrolled in this term. Classes are
      // per-term rows, so this must be term-scoped or every class appears once
      // per term it has ever run.
      const terms = await fetchAllTerms()
      const cur = getCurrentTerm(terms)
      if (cur) {
        const { data: cls } = await enrolledClassesForTerm(
          user.id, cur.id, 'id, class_name').eq('status', 'active')
        const names = (cls || []).map(c => c.classes).filter(Boolean)
        const subs = [...new Set(names.map(c => inferSubject(c)).filter(Boolean))].sort()
        setSubjects(subs)
        if (subs.length) setSubTab(t => t || subs[0])
      }
    })()
  }, [router])

  const senior = year === '11' || year === '12'

  // Rows for the active tab. "Other" catches anything matching no enrolled
  // subject, so a paper can never be filtered into invisibility.
  const inSubject = (r, sub) => subjectsMatch(r.subject || '', sub)
  const visible = useMemo(() => {
    if (!subTab) return rows || []
    if (subTab === '__other') return (rows || []).filter(r => !subjects.some(sub => inSubject(r, sub)))
    return (rows || []).filter(r => inSubject(r, subTab))
  }, [rows, subTab, subjects])

  const hasOther = useMemo(
    () => (rows || []).some(r => !subjects.some(sub => inSubject(r, sub))),
    [rows, subjects])

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

  const addRow = async () => {
    if (!form.paper.trim()) { setErr('Give the paper a name — e.g. “2023 HSC”.'); return }
    setSaving(true); setErr('')
    // Logging from inside a subject tab fills the subject in for you.
    const tabSubject = subTab && subTab !== '__other' ? subTab : ''
    const payload = {
      student_id: student.id,
      paper: form.paper.trim(),
      paper_year: form.paper_year === '' ? null : Number(form.paper_year),
      subject: form.subject.trim() || tabSubject || null,
      attempt_date: form.attempt_date || null,
      mcq_mark: form.mcq_mark === '' ? null : Number(form.mcq_mark),
      mcq_total: form.mcq_total === '' ? null : Number(form.mcq_total),
      written_mark: form.written_mark === '' ? null : Number(form.written_mark),
      written_total: form.written_total === '' ? null : Number(form.written_total),
      notes: form.notes.trim() || null,
    }
    // Keep the paper total in step with the sections it was built from.
    const tot = sectionTotals(payload)
    payload.mark = tot.mark
    payload.total = tot.total
    const { data, error } = await supabase.from('past_paper_attempts')
      .insert(payload).select('*').single()
    if (error) setErr('Could not save: ' + error.message)
    else {
      setRows(rs => [data, ...rs].sort((a, b) =>
        String(b.attempt_date || '').localeCompare(String(a.attempt_date || ''))
        || (b.paper_year || 0) - (a.paper_year || 0)))
      setForm(EMPTY_FORM)
    }
    setSaving(false)
  }

  const saveEdit = async () => {
    if (!editForm.paper.trim()) return
    const payload = {
      paper: editForm.paper.trim(),
      paper_year: editForm.paper_year === '' ? null : Number(editForm.paper_year),
      subject: editForm.subject.trim() || null,
      attempt_date: editForm.attempt_date || null,
      mcq_mark: editForm.mcq_mark === '' ? null : Number(editForm.mcq_mark),
      mcq_total: editForm.mcq_total === '' ? null : Number(editForm.mcq_total),
      written_mark: editForm.written_mark === '' ? null : Number(editForm.written_mark),
      written_total: editForm.written_total === '' ? null : Number(editForm.written_total),
      notes: editForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const etot = sectionTotals(payload)
    payload.mark = etot.mark
    payload.total = etot.total
    const { error } = await supabase.from('past_paper_attempts').update(payload).eq('id', editingId)
    if (!error) setRows(rs => rs.map(r => (r.id === editingId ? { ...r, ...payload } : r)))
    setEditingId(null)
  }

  const removeRow = async (id) => {
    if (!confirm('Delete this attempt?')) return
    await supabase.from('past_paper_attempts').delete().eq('id', id)
    setRows(rs => rs.filter(r => r.id !== id))
  }

  const inputCls = 'border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] w-full'

  // A section cell: raw marks with its own percentage under them. A paper with
  // no such section (English has no MCQ) shows a dash rather than 0%.
  const SectionCell = ({ mark, total, bold = false }) => {
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

  const showExamples = rows.length === 0

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav studentName={student.full_name} />
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">Year {year}</p>
        <h1 className="text-2xl font-bold text-[#2A2035] font-display mb-1">Past Paper Tracker</h1>
        <p className="text-xs text-[#2A2035]/55 mb-6 max-w-2xl">
          Log every paper you attempt — the mark matters less than the <strong>topics to revise</strong> column.
          Your teachers can see this too, so keep it honest and they can help where it counts.
        </p>

        {(subjects.length > 0 || hasOther) && (
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {[
              ...subjects.map(sub => [sub, sub]),
              ...(hasOther ? [['__other', 'Other']] : []),
            ].map(([v, label]) => {
              const n = v === '__other'
                ? rows.filter(r => !subjects.some(sub => inSubject(r, sub))).length
                : rows.filter(r => inSubject(r, v)).length
              const on = subTab === v
              return (
                <button key={v} onClick={() => setSubTab(v)}
                  className={`px-3.5 py-1.5 rounded-xl border text-sm font-semibold transition ${on
                    ? 'bg-[#DEE7FF] text-[#062E63] border-[#BACBFF]'
                    : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}>
                  {label}
                  <span className={`ml-1.5 text-[10px] font-bold ${on ? 'text-[#325099]' : 'text-[#2A2035]/35'}`}>{n}</span>
                </button>
              )
            })}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[
              ['Average total', stats.avg, stats.avgN, 'whole papers'],
              ['Average MCQ', stats.mcqAvg, stats.mcqN, 'multiple choice'],
              ['Average written', stats.writtenAvg, stats.writtenN, 'short + extended'],
            ].map(([l, v, n, sub]) => (
              <div key={l} className="bg-white rounded-2xl border border-[#DEE7FF] px-4 py-3.5">
                <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{l}</p>
                <p className="text-3xl font-bold mt-0.5 font-display" style={{ color: pctColor(v) }}>
                  {v != null ? `${v}%` : '—'}
                </p>
                <p className="text-[10px] text-[#2A2035]/45">
                  {v != null ? `${sub} · ${n} paper${n === 1 ? '' : 's'}` : `no ${sub} logged yet`}
                </p>
              </div>
            ))}
          </div>
        )}
        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              [subTab ? 'Papers · this subject' : 'Papers logged', stats.n, '#062E63'],
              ['Best paper', stats.best != null ? `${stats.best}%` : '—', '#047857'],
              ['Last attempt', stats.last ? fmtDate(stats.last) : '—', '#062E63'],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-white rounded-2xl border border-[#DEE7FF] px-4 py-2.5">
                <p className="text-[9px] tracking-[0.18em] uppercase text-[#325099]/60 font-bold">{l}</p>
                <p className="text-base font-bold mt-0.5 font-display" style={{ color: c }}>{v}</p>
              </div>
            ))}
          </div>
        )}

        {/* Add a paper */}
        <div className="bg-white rounded-2xl border border-[#DEE7FF] p-4 mb-6">
          <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-bold mb-3">＋ Log a paper</p>
          <div className="grid grid-cols-2 md:grid-cols-[80px_1.3fr_1.2fr_1fr_70px_70px] gap-2 mb-2">
            <input className={inputCls} placeholder="Year" inputMode="numeric" maxLength={4} value={form.paper_year}
              onChange={e => setForm(f => ({ ...f, paper_year: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
            <input className={inputCls} placeholder="Paper — e.g. HSC" value={form.paper}
              onChange={e => setForm(f => ({ ...f, paper: e.target.value }))} />
            <input className={inputCls} list="pp-subjects" value={form.subject}
              placeholder={subTab && subTab !== '__other' ? subTab : 'Subject'}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            <input className={inputCls} type="date" value={form.attempt_date}
              onChange={e => setForm(f => ({ ...f, attempt_date: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-2">
            {[
              ['MCQ', 'mcq_mark', 'mcq_total'],
              ['Written', 'written_mark', 'written_total'],
            ].map(([label, mk, tk]) => {
              const p = pct(form[mk], form[tk])
              return (
                <div key={label} className="flex items-center gap-2 rounded-lg border border-[#EEF2FB] bg-[#F8FAFF] px-2.5 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#325099]/70 w-14 shrink-0">{label}</span>
                  <input className={`${inputCls} w-16`} placeholder="Mark" inputMode="decimal" value={form[mk]}
                    onChange={e => setForm(f => ({ ...f, [mk]: e.target.value.replace(/[^\d.]/g, '') }))} />
                  <span className="text-[#2A2035]/35">/</span>
                  <input className={`${inputCls} w-16`} placeholder="Total" inputMode="decimal" value={form[tk]}
                    onChange={e => setForm(f => ({ ...f, [tk]: e.target.value.replace(/[^\d.]/g, '') }))} />
                  <span className="text-[11px] font-bold tabular-nums ml-auto" style={{ color: pctColor(p) }}>
                    {p != null ? `${p}%` : ''}
                  </span>
                </div>
              )
            })}
          </div>
          <datalist id="pp-subjects">
            {(subjects.length ? subjects : SUBJECT_SUGGESTIONS).map(s => <option key={s} value={s} />)}
          </datalist>
          <div className="flex gap-2 items-start">
            <input className={inputCls} placeholder="Topics to revise / notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') addRow() }} />
            <button onClick={addRow} disabled={saving}
              className="shrink-0 px-5 py-1.5 rounded-lg bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
              {saving ? '…' : 'Add'}
            </button>
          </div>
          {(() => {
            const t = sectionTotals(form)
            const p = pct(t.mark, t.total)
            if (p == null) return null
            return (
              <p className="text-[11px] mt-1.5 font-semibold" style={{ color: pctColor(p) }}>
                Paper total: {t.mark}/{t.total} = {p}%
              </p>
            )
          })()}
          {err && <p className="text-xs text-[#B23A3A] mt-2">{err}</p>}
        </div>

        {/* The tracker */}
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[9px] tracking-[0.16em] uppercase text-[#325099]/60 border-b border-[#EEF2FB]">
                {['Year', 'Paper', 'Subject', 'Date', 'MCQ', 'Written', 'Total', 'Topics to revise', ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showExamples && EXAMPLES.map((r, i) => (
                <tr key={`ex-${i}`} className="border-b border-[#F4F7FF] opacity-45 select-none">
                  <td className="px-4 py-2.5 tabular-nums font-semibold text-[#062E63]">{r.paper_year}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#2A2035]">
                    {r.paper}
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-[#325099] bg-[#DEE7FF] px-1.5 py-0.5 rounded align-middle">example</span>
                  </td>
                  <td className="px-4 py-2.5">{r.subject}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(r.attempt_date)}</td>
                  <td className="px-4 py-2.5"><SectionCell mark={r.mcq_mark} total={r.mcq_total} /></td>
                  <td className="px-4 py-2.5"><SectionCell mark={r.written_mark} total={r.written_total} /></td>
                  <td className="px-4 py-2.5"><SectionCell {...sectionTotals(r)} bold /></td>
                  <td className="px-4 py-2.5 text-[#2A2035]/70">{r.notes}</td>
                  <td />
                </tr>
              ))}
              {visible.map(r => {
                if (editingId === r.id) return (
                  <tr key={r.id} className="border-b border-[#F4F7FF] bg-[#F8FAFF]">
                    <td className="px-2 py-2"><input className={inputCls} inputMode="numeric" maxLength={4} value={editForm.paper_year} onChange={e => setEditForm(f => ({ ...f, paper_year: e.target.value.replace(/\D/g, '').slice(0, 4) }))} /></td>
                    <td className="px-2 py-2"><input className={inputCls} value={editForm.paper} onChange={e => setEditForm(f => ({ ...f, paper: e.target.value }))} /></td>
                    <td className="px-2 py-2"><input className={inputCls} list="pp-subjects" value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} /></td>
                    <td className="px-2 py-2"><input className={inputCls} type="date" value={editForm.attempt_date} onChange={e => setEditForm(f => ({ ...f, attempt_date: e.target.value }))} /></td>
                    {[['mcq_mark', 'mcq_total'], ['written_mark', 'written_total']].map(([mk, tk]) => (
                      <td key={mk} className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <input className={`${inputCls} w-14`} inputMode="decimal" value={editForm[mk]} onChange={e => setEditForm(f => ({ ...f, [mk]: e.target.value.replace(/[^\d.]/g, '') }))} />
                          <span className="text-[#2A2035]/40">/</span>
                          <input className={`${inputCls} w-14`} inputMode="decimal" value={editForm[tk]} onChange={e => setEditForm(f => ({ ...f, [tk]: e.target.value.replace(/[^\d.]/g, '') }))} />
                        </div>
                      </td>
                    ))}
                    <td className="px-2 py-2 tabular-nums text-[#2A2035]/50">
                      {(() => { const t = sectionTotals(editForm); const p = pct(t.mark, t.total)
                        return p != null ? `${t.mark}/${t.total} · ${p}%` : '—' })()}
                    </td>
                    <td className="px-2 py-2"><input className={inputCls} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }} /></td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <button onClick={saveEdit} className="text-[11px] font-bold text-[#047857] mr-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-[11px] text-[#2A2035]/45">Cancel</button>
                    </td>
                  </tr>
                )
                return (
                  <tr key={r.id} className="border-b border-[#F4F7FF] last:border-0">
                    <td className="px-4 py-2.5 tabular-nums font-semibold text-[#062E63]">{r.paper_year || <span className="text-[#2A2035]/30">—</span>}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#2A2035]">{r.paper}</td>
                    <td className="px-4 py-2.5">{r.subject || <span className="text-[#2A2035]/30">—</span>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(r.attempt_date)}</td>
                    <td className="px-4 py-2.5"><SectionCell mark={r.mcq_mark} total={r.mcq_total} /></td>
                    <td className="px-4 py-2.5"><SectionCell mark={r.written_mark} total={r.written_total} /></td>
                    <td className="px-4 py-2.5"><SectionCell {...sectionTotals(r)} bold /></td>
                    <td className="px-4 py-2.5 text-[#2A2035]/70">{r.notes || <span className="text-[#2A2035]/30">—</span>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      <button title="Edit" className="text-[#325099]/60 hover:text-[#325099] mr-2"
                        onClick={() => { setEditingId(r.id); setEditForm({
                          paper_year: r.paper_year ?? '', paper: r.paper || '',
                          subject: r.subject || '', attempt_date: r.attempt_date || '',
                          mcq_mark: r.mcq_mark ?? '', mcq_total: r.mcq_total ?? '',
                          written_mark: r.written_mark ?? '', written_total: r.written_total ?? '',
                          notes: r.notes || '',
                        }) }}>✏️</button>
                      <button title="Delete" className="text-[#B23A3A]/50 hover:text-[#B23A3A]"
                        onClick={() => removeRow(r.id)}>✕</button>
                    </td>
                  </tr>
                )
              })}
              {!showExamples && visible.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-xs text-[#2A2035]/45">
                  Nothing logged for {subTab === '__other' ? 'other subjects' : subTab} yet — add your first paper above.
                </td></tr>
              )}
            </tbody>
          </table>
          {showExamples && (
            <p className="px-4 py-3 text-[11px] text-[#2A2035]/45 border-t border-[#F4F7FF]">
              The grey rows are just examples of how to use the tracker — they disappear once you log your first paper above.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
