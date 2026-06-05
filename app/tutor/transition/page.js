'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS, T_PARENTS, T_INVOICES, T_TERMS } from '../../../lib/tables'

/*
 * Term Transition Wizard — /tutor/transition
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only. A 6-step checklist that walks through every action needed to
 * move from one term to the next:
 *
 *   1. Setup       — pick source + target terms; see snapshot stats
 *   2. Enrolments  — mark who isn't continuing and their reason
 *   3. Classes     — choose which classes to copy; execute rollover
 *   4. Comms       — generate re-enrolment email drafts per family (copy / CSV)
 *   5. Invoices    — bulk-create invoice records for the new term
 *   6. Done        — summary of everything created
 *
 * Designed to be re-runnable: the rollover step skips any class that already
 * exists in the target term (by name), and invoice generation can be skipped
 * entirely if invoices are managed in Xero.
 *
 * DB prerequisites — run migrations/20260604_term_transition.sql once:
 *   ALTER TABLE enrolments ADD COLUMN IF NOT EXISTS ended_at date;
 *   ALTER TABLE enrolments ADD COLUMN IF NOT EXISTS end_reason text;
 *   (term_transitions + enquiries tables — see migration file)
 */

// ── Constants ──────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Setup',       icon: '📋' },
  { id: 2, label: 'Enrolments',  icon: '👥' },
  { id: 3, label: 'Classes',     icon: '📚' },
  { id: 4, label: 'Comms',       icon: '✉️'  },
  { id: 5, label: 'Invoices',    icon: '💰' },
  { id: 6, label: 'Done',        icon: '✅' },
]

const END_REASONS = [
  'Graduated / Year 12 finished',
  'Paused — may return next term',
  'Withdrew from tutoring',
  'Changed subject',
  'Other',
]

// ── Utility helpers ────────────────────────────────────────────────────────
const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

const isoToday = () => new Date().toISOString().slice(0, 10)

function buildEmailBody(parentName, students, toTerm) {
  const termRange = toTerm
    ? `${fmtDate(toTerm.start_date)} to ${fmtDate(toTerm.end_date)}`
    : 'the upcoming term'
  const weeks = toTerm
    ? Math.round((new Date(toTerm.end_date) - new Date(toTerm.start_date)) / (7 * 86400000)) + 1
    : '?'

  const classLines = students
    .map(s => `  • ${s.student_name} — ${s.class_name || s.class?.class_name || '—'}${s.class_day ? ` (${s.class_day}${s.class_start ? ', ' + s.class_start : ''})` : ''}`)
    .join('\n')

  return `Hi ${parentName || 'there'},

We're looking forward to seeing you again for ${toTerm?.name || 'the next term'} at CUBE Tutoring.

This is a confirmation that the following enrolments have been carried over:

${classLines}

Term dates: ${termRange} (${weeks} weeks)

An invoice will follow shortly. Please reply if anything has changed or if you have any questions.

Kind regards,
The CUBE Team`.trim()
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function TransitionPage() {
  const router = useRouter()

  // Auth
  const [profile, setProfile] = useState(null)

  // Terms
  const [terms, setTerms]         = useState([])
  const [fromTermId, setFromTermId] = useState('')
  const [toTermId, setToTermId]     = useState('')

  // UI state
  const [step, setStep]     = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  // Step 1
  const [termStats, setTermStats] = useState(null)

  // Step 2 + 3 shared data
  const [enrolments, setEnrolments] = useState([])  // enriched rows
  const [classes, setClasses]       = useState([])  // classes in fromTerm
  const [dataLoaded, setDataLoaded] = useState(false)

  // Step 2
  const [endings, setEndings]           = useState({})  // { enrolment_id: { ending, reason } }
  const [nextTermStatus, setNextTermStatus] = useState({})  // { enrolment_id: 'pending'|'confirmed'|'not_continuing' }
  const [enrolmentSearch, setEnrolmentSearch] = useState('')

  // Step 3
  const [selectedClasses, setSelectedClasses] = useState({})
  const [copyEnrolments, setCopyEnrolments]   = useState(true)
  const [rolloverDone, setRolloverDone]       = useState(false)
  const [rolloverResult, setRolloverResult]   = useState(null)

  // Step 4
  const [emailRows, setEmailRows] = useState([])

  // Step 5
  const [invoiceRows, setInvoiceRows]     = useState([])
  const [invoicesDone, setInvoicesDone]   = useState(false)
  const [invoicesCreated, setInvoicesCreated] = useState(0)

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor'); return
      }
      setProfile(profile)
    })
    fetchAllTerms().then(allTerms => {
      setTerms(allTerms)
      const cur = getCurrentTerm(allTerms)
      if (cur) {
        setFromTermId(cur.id)
        const sorted = [...allTerms].sort((a, b) => a.start_date.localeCompare(b.start_date))
        const idx = sorted.findIndex(t => t.id === cur.id)
        if (idx >= 0 && idx + 1 < sorted.length) setToTermId(sorted[idx + 1].id)
      }
      setLoading(false)
    })
  }, [router])

  // ── Step 1: term snapshot stats ───────────────────────────────────────────
  const loadTermStats = useCallback(async (termId) => {
    if (!termId) return
    let { data: cls } = await supabase
      .from(T_CLASSES).select('id').eq('term_id', termId)
    // Fallback: if no classes have this term_id, count all classes
    if (!cls?.length) {
      const all = await supabase.from(T_CLASSES).select('id')
      cls = all.data || []
    }
    const classIds = (cls || []).map(c => c.id)
    if (!classIds.length) { setTermStats({ classes: 0, enrolments: 0, students: 0 }); return }

    const { data: enr } = await supabase
      .from(T_ENROLMENTS).select('id, student_id').in('class_id', classIds).eq('status', 'active')
    setTermStats({
      classes:    classIds.length,
      enrolments: enr?.length ?? 0,
      students:   new Set((enr || []).map(e => e.student_id)).size,
    })
  }, [])

  useEffect(() => {
    if (fromTermId) loadTermStats(fromTermId)
    else setTermStats(null)
  }, [fromTermId, loadTermStats])

  // ── Step 2 / 3: load enriched enrolments + classes ────────────────────────
  const loadData = useCallback(async () => {
    if (!fromTermId) return
    setLoading(true)
    try {
      // Try to load classes scoped to this term first.
      // Falls back to ALL classes if none have term_id set (common for pre-existing data
      // where the term_id column exists but rows were created before it was populated).
      const clsQuery = await supabase
        .from(T_CLASSES)
        .select('*')
        .eq('term_id', fromTermId)
        .order('class_name')

      if (clsQuery.error) throw new Error(`Classes query failed: ${clsQuery.error.message}`)

      let cls = clsQuery.data || []

      if (!cls.length) {
        // Fallback: no classes have this term_id — load everything
        const fallback = await supabase
          .from(T_CLASSES)
          .select('*')
          .order('class_name')
        if (fallback.error) throw new Error(`Classes fallback query failed: ${fallback.error.message}`)
        cls = fallback.data || []
      }

      const classMap = Object.fromEntries(cls.map(c => [c.id, c]))
      const classIds = cls.map(c => c.id)

      setClasses(cls)
      setSelectedClasses(Object.fromEntries(cls.map(c => [c.id, true])))

      if (!classIds.length) { setEnrolments([]); setDataLoaded(true); setLoading(false); return }

      const { data: enr, error: enrErr } = await supabase
        .from(T_ENROLMENTS)
        .select('*')
        .in('class_id', classIds)

      if (enrErr) throw new Error(`Enrolments query failed: ${enrErr.message}`)

      const activeEnr = (enr || []).filter(e => e.status === 'active' || e.status === 'trial')
      if (!activeEnr.length) { setEnrolments([]); setDataLoaded(true); setLoading(false); return }

      const studentIds = [...new Set(activeEnr.map(e => e.student_id))]
      const { data: studs } = await supabase
        .from(T_STUDENTS).select('id, full_name, year, family_id').in('id', studentIds)
      const studMap = Object.fromEntries((studs || []).map(s => [s.id, s]))

      // Parents — look up by student_id (UUID) to avoid family_id serial collisions
      let parentMap = {}
      if (studentIds.length) {
        const { data: parents } = await supabase
          .from(T_PARENTS).select('student_id, full_name, email, phone').in('student_id', studentIds)
        parentMap = Object.fromEntries((parents || []).map(p => [p.student_id, p]))
      }

      const rows = activeEnr.map(e => {
        const s = studMap[e.student_id] || {}
        const p = parentMap[e.student_id] || {}
        const c = classMap[e.class_id]   || {}
        return {
          id:           e.id,
          student_id:   e.student_id,
          class_id:     e.class_id,
          student_name: s.full_name || '—',
          year:         s.year,
          class_name:   c.class_name || '—',
          class_day:    c.day_of_week || '',
          class_start:  c.start_time || '',
          class_end:    c.end_time || '',
          family_id:        s.family_id || null,
          parent_name:      p.full_name || '',
          parent_email:     p.email || '',
          next_term_status: e.next_term_status || 'pending',
          end_reason:       e.end_reason || '',
        }
      }).sort((a, b) => (a.class_name + a.student_name).localeCompare(b.class_name + b.student_name))

      setEnrolments(rows)

      const initEndings = {}
      const initStatuses = {}
      for (const r of rows) {
        const s = r.next_term_status || 'confirmed'
        initStatuses[r.id] = s
        initEndings[r.id]  = { ending: s === 'not_continuing', reason: r.end_reason || '' }
      }
      setNextTermStatus(initStatuses)
      setEndings(initEndings)
      setDataLoaded(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [fromTermId])

  // ── Step 2: update per-enrolment confirmation status ─────────────────────
  const updateStatus = async (enrolmentId, status) => {
    setNextTermStatus(prev => ({ ...prev, [enrolmentId]: status }))
    setEndings(prev => ({
      ...prev,
      [enrolmentId]: { ...prev[enrolmentId], ending: status === 'not_continuing' },
    }))
    await supabase.from(T_ENROLMENTS)
      .update({ next_term_status: status })
      .eq('id', enrolmentId)
  }

  // ── Step 4: build email rows ──────────────────────────────────────────────
  const buildEmailRows = useCallback(() => {
    const toTerm = terms.find(t => t.id === toTermId)
    const continuing = enrolments.filter(e => !endings[e.id]?.ending)

    const familyMap = {}
    for (const e of continuing) {
      const key = e.family_id || ('student:' + e.student_id)
      if (!familyMap[key]) familyMap[key] = {
        family_id:    e.family_id,
        parent_name:  e.parent_name || e.student_name,
        parent_email: e.parent_email,
        students:     [],
      }
      familyMap[key].students.push(e)
    }

    setEmailRows(Object.values(familyMap).map(f => ({
      ...f,
      subject: `CUBE Tutoring — ${toTerm?.name || 'Next Term'} Re-enrolment`,
      body:    buildEmailBody(f.parent_name, f.students, toTerm),
      copied:  false,
    })))
  }, [enrolments, endings, terms, toTermId])

  // ── Step 5: build invoice rows ─────────────────────────────────────────────
  const buildInvoiceRows = useCallback(() => {
    const continuing = enrolments.filter(e => !endings[e.id]?.ending)

    const familyMap = {}
    for (const e of continuing) {
      const key = e.family_id || ('student:' + e.student_id)
      if (!familyMap[key]) familyMap[key] = {
        family_id:    e.family_id,
        parent_name:  e.parent_name || e.student_name,
        parent_email: e.parent_email,
        students:     [],
        fee:          '',
        checked:      true,
      }
      familyMap[key].students.push({
        student_id:   e.student_id,
        student_name: e.student_name,
        class_name:   e.class_name,
      })
    }
    setInvoiceRows(Object.values(familyMap))
  }, [enrolments, endings])

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goTo = async (nextStep) => {
    setError(null)
    if (nextStep === 2) await loadData()
    if (nextStep >= 3 && !dataLoaded) await loadData()
    if (nextStep === 4) buildEmailRows()
    if (nextStep === 5) buildInvoiceRows()
    setStep(nextStep)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Step 3: execute rollover ───────────────────────────────────────────────
  const executeRollover = async () => {
    setSaving(true); setError(null)
    try {
      const toTerm = terms.find(t => t.id === toTermId)
      if (!toTerm) throw new Error('Target term not found.')

      const endingIds = new Set(
        Object.entries(endings).filter(([, v]) => v.ending).map(([k]) => k)
      )

      const classesToRoll = classes.filter(c => selectedClasses[c.id])

      // Check which class names already exist in target term
      const { data: existing } = await supabase
        .from(T_CLASSES).select('class_name').eq('term_id', toTermId)
      const existingNames = new Set((existing || []).map(c => (c.class_name || '').toLowerCase()))

      const skipped   = []
      let createdEnrolments = 0
      const createdClassObjs = []

      for (const origCls of classesToRoll) {
        if (existingNames.has((origCls.class_name || '').toLowerCase())) {
          skipped.push(origCls.class_name); continue
        }

        // Strip PK + auto columns before inserting
        const { id: origId, created_at, ...clsFields } = origCls
        const { data: newCls, error: clsErr } = await supabase
          .from(T_CLASSES)
          .insert({ ...clsFields, term_id: toTermId })
          .select().single()
        if (clsErr) throw clsErr
        createdClassObjs.push(newCls)

        if (copyEnrolments) {
          const enrsForClass = enrolments.filter(
            e => e.class_id === origId && !endingIds.has(e.id)
          )
          for (const e of enrsForClass) {
            const { error: enrErr } = await supabase
              .from(T_ENROLMENTS)
              .insert({ student_id: e.student_id, class_id: newCls.id, status: 'active' })
            if (!enrErr) createdEnrolments++
          }
        }
      }

      // Mark ending enrolments as disenrolled
      for (const id of endingIds) {
        const { reason } = endings[id] || {}
        const update = {
          status:           'disenrol',
          next_term_status: 'not_continuing',
          ended_at:         isoToday(),
        }
        if (reason) update.end_reason = reason
        await supabase.from(T_ENROLMENTS).update(update).eq('id', id)
      }

      setRolloverResult({ createdClasses: createdClassObjs.length, createdEnrolments, skipped })
      setRolloverDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 5: generate invoices ──────────────────────────────────────────────
  const generateInvoices = async () => {
    setSaving(true); setError(null)
    let count = 0
    for (const row of invoiceRows.filter(r => r.checked && r.fee)) {
      const { error: invErr } = await supabase.from(T_INVOICES).insert({
        term_id:    toTermId,
        family_id:  row.family_id,
        total:      parseFloat(row.fee),
        subtotal:   parseFloat(row.fee),
        email_sent: false,
        notes:      row.students.map(s => s.class_name).join(', '),
      })
      if (!invErr) count++
    }
    setInvoicesCreated(count)
    setInvoicesDone(true)
    setSaving(false)
  }

  // ── Copy single email ─────────────────────────────────────────────────────
  const copyEmail = (idx) => {
    const row = emailRows[idx]
    navigator.clipboard.writeText(`To: ${row.parent_email}\nSubject: ${row.subject}\n\n${row.body}`)
    setEmailRows(prev => prev.map((r, i) => i === idx ? { ...r, copied: true } : r))
  }

  // ── Download comms CSV ────────────────────────────────────────────────────
  const downloadEmailCSV = () => {
    const toTerm = terms.find(t => t.id === toTermId)
    const header = ['Name', 'Email', 'Subject', 'Body']
    const csvRows = [header, ...emailRows.map(r => [
      r.parent_name, r.parent_email, r.subject, r.body.replace(/\n/g, '\\n'),
    ])]
    const csv = csvRows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `comms_${(toTerm?.name || 'term').replace(/\s+/g, '_')}.csv`
    a.click()
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const fromTerm          = terms.find(t => t.id === fromTermId)
  const toTerm            = terms.find(t => t.id === toTermId)
  const confirmedCount     = Object.values(nextTermStatus).filter(s => s === 'confirmed').length
  const notContinuingCount = Object.values(nextTermStatus).filter(s => s === 'not_continuing').length
  const endingCount        = notContinuingCount
  const continuingCount    = enrolments.length - notContinuingCount
  const allSelected       = classes.length > 0 && Object.values(selectedClasses).every(Boolean)

  if (loading && !terms.length) return (
    <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
      <span className="text-[#325099]/50 text-sm">Loading…</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 pt-10 pb-4">
        <h1 className="text-2xl font-bold text-[#062E63]">Term Transition</h1>
        <p className="text-sm text-[#325099]/60 mt-1">
          {fromTerm && toTerm
            ? `${fromTerm.name} → ${toTerm.name}`
            : 'Set up a term transition'}
        </p>
      </div>

      {/* ── Step progress bar ─────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 mb-8">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => step > s.id ? goTo(s.id) : undefined}
                disabled={step <= s.id}
                className={`flex flex-col items-center gap-1 w-full transition ${
                  step > s.id  ? 'cursor-pointer opacity-70 hover:opacity-100' :
                  step === s.id ? 'cursor-default opacity-100' :
                  'cursor-default opacity-30'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition ${
                  step > s.id   ? 'bg-[#10b981] border-[#10b981] text-white' :
                  step === s.id ? 'bg-[#062E63] border-[#062E63] text-white' :
                  'bg-white border-[#DEE7FF] text-[#062E63]/40'
                }`}>
                  {step > s.id ? '✓' : s.icon}
                </div>
                <span className="text-[10px] font-semibold text-[#062E63]/60 hidden sm:block truncate">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 mx-1 transition-colors ${step > s.id ? 'bg-[#10b981]' : 'bg-[#DEE7FF]'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 pb-24">

        {/* ═══ STEP 1: Setup ═══════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8">
            <h2 className="text-lg font-bold text-[#062E63] mb-6">Choose terms</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
              {[
                { label: 'Current term (rolling from)', val: fromTermId, set: (v) => { setFromTermId(v); setTermStats(null); setDataLoaded(false) } },
                { label: 'Next term (rolling to)',      val: toTermId,   set: setToTermId },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <label className="block text-xs font-semibold text-[#325099]/70 mb-1.5">{label}</label>
                  <select
                    value={val}
                    onChange={e => set(e.target.value)}
                    className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2.5 text-sm text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/25"
                  >
                    <option value="">Select term…</option>
                    {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* Term date ranges */}
            {fromTerm && toTerm && (
              <div className="grid grid-cols-2 gap-4 mb-6">
                {[fromTerm, toTerm].map((t, i) => (
                  <div key={t.id} className="bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-3">
                    <div className="text-[11px] font-semibold text-[#325099]/60 mb-0.5">{i === 0 ? 'From' : 'To'} · {t.name}</div>
                    <div className="text-sm text-[#062E63] font-medium">
                      {fmtDate(t.start_date)} → {fmtDate(t.end_date)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Stats */}
            {termStats && fromTerm && (
              <div className="grid grid-cols-3 gap-4 mb-8">
                {[
                  { label: 'Classes',    value: termStats.classes },
                  { label: 'Enrolments', value: termStats.enrolments },
                  { label: 'Students',   value: termStats.students },
                ].map(s => (
                  <div key={s.label} className="bg-[#EEF3FF] rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-[#062E63]">{s.value}</div>
                    <div className="text-xs text-[#325099]/60 font-semibold mt-0.5">{s.label}</div>
                    <div className="text-[10px] text-[#325099]/40 mt-0.5">in {fromTerm.name}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => goTo(2)}
                disabled={!fromTermId || !toTermId || fromTermId === toTermId}
                className="bg-[#062E63] text-white text-sm font-semibold px-7 py-2.5 rounded-full disabled:opacity-40 hover:bg-[#325099] transition"
              >
                Next: Review enrolments →
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 2: Enrolments ══════════════════════════════════════════ */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8">
            <div className="flex items-start justify-between mb-2 gap-4">
              <div>
                <h2 className="text-lg font-bold text-[#062E63]">Review enrolments</h2>
                <p className="text-sm text-[#325099]/60 mt-0.5">
                  Confirm who is continuing next term. Changes save instantly.
                </p>
              </div>
              <div className="flex-shrink-0 flex gap-2 text-xs font-semibold pt-1">
                {confirmedCount > 0 && (
                  <span className="bg-[#D1FAE5] text-[#065F46] px-2.5 py-1 rounded-full">✓ {confirmedCount} confirmed</span>
                )}
                {notContinuingCount > 0 && (
                  <span className="bg-red-100 text-red-700 px-2.5 py-1 rounded-full">✗ {notContinuingCount} not continuing</span>
                )}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
            )}

            <div className="mb-6">
              {loading ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">Loading…</div>
              ) : enrolments.length === 0 ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">No active enrolments found in {fromTerm?.name}.</div>
              ) : (
                <div className="border border-[#DEE7FF] rounded-xl overflow-hidden">
                  <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-3 py-2 flex items-center gap-2">
                    <span className="text-[#325099]/40 text-xs">🔍</span>
                    <input
                      type="text"
                      value={enrolmentSearch}
                      onChange={e => setEnrolmentSearch(e.target.value)}
                      placeholder="Search by student or class…"
                      className="flex-1 bg-transparent text-xs text-[#062E63] placeholder-[#325099]/40 focus:outline-none"
                    />
                    {enrolmentSearch && (
                      <button onClick={() => setEnrolmentSearch('')} className="text-[#325099]/40 hover:text-[#325099] text-xs">✕</button>
                    )}
                  </div>
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Student</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Yr</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Class</th>
                        <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Status</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enrolments
                        .filter(e => {
                          if (!enrolmentSearch.trim()) return true
                          const q = enrolmentSearch.toLowerCase()
                          return e.student_name.toLowerCase().includes(q) ||
                                 e.class_name.toLowerCase().includes(q) ||
                                 String(e.year).includes(q)
                        })
                        .map((e, i) => {
                        const status = nextTermStatus[e.id] || 'confirmed'
                        const end    = endings[e.id] || { ending: false, reason: '' }
                        const rowBg  = status === 'confirmed'
                          ? 'bg-[#F0FDF4]'
                          : status === 'not_continuing'
                          ? 'bg-red-50'
                          : i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'
                        return (
                          <tr key={e.id} className={`border-b border-[#DEE7FF] last:border-0 ${rowBg}`}>
                            <td className="px-4 py-2.5 font-medium text-[#062E63]">{e.student_name}</td>
                            <td className="px-4 py-2.5 text-[#325099]/60 text-xs">Y{e.year}</td>
                            <td className="px-4 py-2.5 text-[#325099]/80 text-xs">{e.class_name}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex gap-1 justify-center">
                                {[
                                  { value: 'confirmed',      label: '✓', title: 'Confirmed',      active: 'bg-[#D1FAE5] text-[#065F46] border-[#34D399]' },
                                  { value: 'not_continuing', label: '✗', title: 'Not continuing', active: 'bg-red-100 text-red-700 border-red-300' },
                                ].map(btn => (
                                  <button
                                    key={btn.value}
                                    title={btn.title}
                                    onClick={() => updateStatus(e.id, btn.value)}
                                    className={`w-7 h-7 rounded-full text-xs font-bold border transition ${
                                      status === btn.value
                                        ? btn.active
                                        : 'bg-white text-[#325099]/30 border-[#DEE7FF] hover:border-[#325099]/40 hover:text-[#325099]/60'
                                    }`}
                                  >
                                    {btn.label}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {status === 'not_continuing' && (
                                <select
                                  value={end.reason}
                                  onChange={ev => setEndings(prev => ({
                                    ...prev,
                                    [e.id]: { ...prev[e.id], reason: ev.target.value },
                                  }))}
                                  className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] bg-white"
                                >
                                  <option value="">Select reason…</option>
                                  {END_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {enrolmentSearch.trim() && (
                    <div className="px-4 py-2 bg-[#F8FAFF] border-t border-[#DEE7FF] text-[11px] text-[#325099]/50">
                      {enrolments.filter(e => {
                        const q = enrolmentSearch.toLowerCase()
                        return e.student_name.toLowerCase().includes(q) || e.class_name.toLowerCase().includes(q) || String(e.year).includes(q)
                      }).length} of {enrolments.length} enrolments
                    </div>
                  )}
                </div>
              )}
            </div>

<div className="flex justify-between">
              <button onClick={() => setStep(1)} className="text-sm text-[#325099]/60 hover:text-[#062E63] px-4 py-2 rounded-full transition">← Back</button>
              <button onClick={() => goTo(3)} className="bg-[#062E63] text-white text-sm font-semibold px-7 py-2.5 rounded-full hover:bg-[#325099] transition">
                Next: Class rollover →
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Classes ═════════════════════════════════════════════ */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8">
            <h2 className="text-lg font-bold text-[#062E63] mb-1.5">Roll over classes</h2>
            <p className="text-sm text-[#325099]/60 mb-6">
              Choose which classes to copy to {toTerm?.name}. Classes that already exist in the target term are automatically skipped.
            </p>

            {/* Copy enrolments toggle */}
            <label className="flex items-center gap-3 mb-6 p-4 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl cursor-pointer select-none">
              <input
                type="checkbox"
                checked={copyEnrolments}
                onChange={e => setCopyEnrolments(e.target.checked)}
                className="accent-[#062E63] w-4 h-4"
              />
              <div>
                <span className="text-sm font-semibold text-[#062E63]">Copy continuing enrolments to new classes</span>
                <span className="text-xs text-[#325099]/50 ml-2">({endingCount} ending enrolments excluded)</span>
              </div>
            </label>

            {/* Class list */}
            <div className="border border-[#DEE7FF] rounded-xl overflow-hidden mb-6">
              <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#325099]/60">
                  {Object.values(selectedClasses).filter(Boolean).length} / {classes.length} classes selected
                </span>
                <button
                  onClick={() => setSelectedClasses(Object.fromEntries(classes.map(c => [c.id, !allSelected])))}
                  className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {classes.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[#325099]/40">No classes in {fromTerm?.name}.</div>
              ) : classes.map((c, i) => {
                const carrying = enrolments.filter(e => e.class_id === c.id && !endings[e.id]?.ending).length
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-4 px-4 py-3 border-b border-[#DEE7FF] last:border-0 hover:bg-[#FAFBFF] cursor-pointer ${
                      i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedClasses[c.id] ?? true}
                      onChange={e => setSelectedClasses(prev => ({ ...prev, [c.id]: e.target.checked }))}
                      className="accent-[#062E63] w-4 h-4"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm text-[#062E63]">{c.class_name}</span>
                      {c.day_of_week && (
                        <span className="text-xs text-[#325099]/50 ml-2">
                          {c.day_of_week}{c.start_time ? ` ${c.start_time}` : ''}{c.end_time ? `–${c.end_time}` : ''}
                        </span>
                      )}
                    </div>
                    {copyEnrolments && (
                      <span className="flex-shrink-0 text-[11px] font-semibold text-[#325099]/50 bg-[#F0F4FF] px-2.5 py-0.5 rounded-full">
                        {carrying} student{carrying !== 1 ? 's' : ''}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            {/* Rollover result */}
            {rolloverDone && rolloverResult && (
              <div className="bg-[#D1FAE5] border border-[#34D399] rounded-xl px-4 py-3.5 mb-6">
                <p className="text-sm font-semibold text-[#065F46]">
                  ✓ Rollover complete — {rolloverResult.createdClasses} classes and {rolloverResult.createdEnrolments} enrolments created in {toTerm?.name}
                </p>
                {rolloverResult.skipped?.length > 0 && (
                  <p className="text-xs text-[#065F46]/70 mt-1">
                    Skipped (already existed): {rolloverResult.skipped.join(', ')}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
            )}

            <div className="flex justify-between items-center">
              <button onClick={() => setStep(2)} className="text-sm text-[#325099]/60 hover:text-[#062E63] px-4 py-2 rounded-full transition">← Back</button>
              <div className="flex gap-3">
                {!rolloverDone && (
                  <button
                    onClick={executeRollover}
                    disabled={saving || !Object.values(selectedClasses).some(Boolean)}
                    className="bg-[#325099] text-white text-sm font-semibold px-6 py-2.5 rounded-full disabled:opacity-40 hover:bg-[#062E63] transition"
                  >
                    {saving ? 'Rolling over…' : '⚡ Execute rollover'}
                  </button>
                )}
                <button
                  onClick={() => goTo(4)}
                  className="bg-[#062E63] text-white text-sm font-semibold px-7 py-2.5 rounded-full hover:bg-[#325099] transition"
                >
                  Next: Communications →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: Communications ══════════════════════════════════════ */}
        {step === 4 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8">
            <div className="flex items-start justify-between mb-2 gap-4">
              <div>
                <h2 className="text-lg font-bold text-[#062E63]">Parent communications</h2>
                <p className="text-sm text-[#325099]/60 mt-0.5">
                  Re-enrolment email drafts for {emailRows.length} {emailRows.length === 1 ? 'family' : 'families'}. Copy individually or download all as a CSV for bulk sending.
                </p>
              </div>
              {emailRows.length > 0 && (
                <button
                  onClick={downloadEmailCSV}
                  className="flex-shrink-0 text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:bg-[#F0F4FF] transition"
                >
                  ↓ Download CSV
                </button>
              )}
            </div>

            <div className="mt-6 space-y-4 mb-6">
              {emailRows.length === 0 ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">No continuing enrolments to communicate with.</div>
              ) : emailRows.map((row, i) => (
                <div key={i} className="border border-[#DEE7FF] rounded-xl overflow-hidden">
                  <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-[#062E63]">{row.parent_name || '—'}</span>
                      <span className="text-xs text-[#325099]/50 ml-2">{row.parent_email || 'no email on file'}</span>
                    </div>
                    <button
                      onClick={() => copyEmail(i)}
                      className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition ${
                        row.copied
                          ? 'bg-[#D1FAE5] text-[#065F46]'
                          : 'border border-[#DEE7FF] text-[#325099] hover:bg-[#F0F4FF]'
                      }`}
                    >
                      {row.copied ? '✓ Copied' : 'Copy email'}
                    </button>
                  </div>
                  <div className="px-4 py-4">
                    <div className="text-[11px] text-[#325099]/40 mb-2 font-medium">Subject: {row.subject}</div>
                    <pre className="text-xs text-[#2A2035]/75 whitespace-pre-wrap font-sans leading-relaxed">{row.body}</pre>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(3)} className="text-sm text-[#325099]/60 hover:text-[#062E63] px-4 py-2 rounded-full transition">← Back</button>
              <button onClick={() => goTo(5)} className="bg-[#062E63] text-white text-sm font-semibold px-7 py-2.5 rounded-full hover:bg-[#325099] transition">
                Next: Invoices →
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 5: Invoices ════════════════════════════════════════════ */}
        {step === 5 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-8">
            <h2 className="text-lg font-bold text-[#062E63] mb-1.5">Generate invoices</h2>
            <p className="text-sm text-[#325099]/60 mb-6">
              Enter the term fee per family and bulk-create invoice records for {toTerm?.name}. Skip this step if you invoice through Xero — you can always create invoices manually in the Database page.
            </p>

            {invoiceRows.length === 0 ? (
              <div className="text-center py-12 text-[#325099]/40 text-sm">No continuing families to invoice.</div>
            ) : (
              <>
                <div className="border border-[#DEE7FF] rounded-xl overflow-hidden mb-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[500px]">
                      <thead>
                        <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                          <th className="px-3 py-2.5 w-8"></th>
                          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Family</th>
                          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Students / Classes</th>
                          <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60 w-36">Term fee ($)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceRows.map((row, i) => (
                          <tr key={i} className={`border-b border-[#DEE7FF] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}`}>
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={row.checked}
                                onChange={e => setInvoiceRows(prev => prev.map((r, j) => j === i ? { ...r, checked: e.target.checked } : r))}
                                className="accent-[#062E63] w-4 h-4"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="font-semibold text-[#062E63]">{row.parent_name || '—'}</div>
                              <div className="text-xs text-[#325099]/50">{row.parent_email}</div>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[#325099]/70">
                              {row.students.map(s => `${s.student_name} (${s.class_name})`).join(' · ')}
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="number"
                                value={row.fee}
                                onChange={e => setInvoiceRows(prev => prev.map((r, j) => j === i ? { ...r, fee: e.target.value } : r))}
                                placeholder="e.g. 800"
                                className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm text-[#062E63] focus:outline-none focus:ring-2 focus:ring-[#325099]/20"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Total */}
                <div className="flex items-center gap-4 p-4 bg-[#EEF3FF] rounded-xl mb-6 text-sm">
                  <span className="text-[#325099]/70">Total revenue:</span>
                  <span className="font-bold text-[#062E63] text-lg">
                    ${invoiceRows
                      .filter(r => r.checked && r.fee)
                      .reduce((s, r) => s + (parseFloat(r.fee) || 0), 0)
                      .toLocaleString('en-AU', { minimumFractionDigits: 0 })}
                  </span>
                  <span className="text-[#325099]/50 text-xs">
                    across {invoiceRows.filter(r => r.checked && r.fee).length} families
                  </span>
                </div>
              </>
            )}

            {invoicesDone && (
              <div className="bg-[#D1FAE5] border border-[#34D399] rounded-xl px-4 py-3.5 mb-6">
                <p className="text-sm font-semibold text-[#065F46]">✓ {invoicesCreated} invoice records created for {toTerm?.name}</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
            )}

            <div className="flex justify-between items-center">
              <button onClick={() => setStep(4)} className="text-sm text-[#325099]/60 hover:text-[#062E63] px-4 py-2 rounded-full transition">← Back</button>
              <div className="flex gap-3">
                {!invoicesDone && invoiceRows.some(r => r.checked && r.fee) && (
                  <button
                    onClick={generateInvoices}
                    disabled={saving}
                    className="bg-[#325099] text-white text-sm font-semibold px-6 py-2.5 rounded-full disabled:opacity-40 hover:bg-[#062E63] transition"
                  >
                    {saving ? 'Generating…' : '💰 Generate invoices'}
                  </button>
                )}
                <button
                  onClick={() => goTo(6)}
                  className="bg-[#062E63] text-white text-sm font-semibold px-7 py-2.5 rounded-full hover:bg-[#325099] transition"
                >
                  Finish →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ STEP 6: Done ════════════════════════════════════════════════ */}
        {step === 6 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-5xl mb-5">✅</div>
            <h2 className="text-xl font-bold text-[#062E63] mb-1">Transition complete</h2>
            <p className="text-sm text-[#325099]/60 mb-8">{fromTerm?.name} → {toTerm?.name}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10 text-left max-w-2xl mx-auto">
              {[
                { label: 'Classes created',   value: rolloverResult?.createdClasses  ?? '—', icon: '📚' },
                { label: 'Students enrolled',  value: rolloverResult?.createdEnrolments ?? '—', icon: '👥' },
                { label: 'Emails drafted',     value: emailRows.length,                       icon: '✉️' },
                { label: 'Invoices created',   value: invoicesCreated || '—',                 icon: '💰' },
              ].map(s => (
                <div key={s.label} className="bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl p-4">
                  <div className="text-2xl mb-1">{s.icon}</div>
                  <div className="text-2xl font-bold text-[#062E63]">{s.value}</div>
                  <div className="text-xs text-[#325099]/60 font-semibold mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-3 flex-wrap">
              <a
                href="/tutor/classes"
                className="bg-[#062E63] text-white text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#325099] transition"
              >
                View {toTerm?.name} classes
              </a>
              <a
                href="/tutor/database"
                className="border border-[#DEE7FF] text-[#325099] text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#F0F4FF] transition"
              >
                Open database
              </a>
              <button
                onClick={() => {
                  setStep(1); setDataLoaded(false); setRolloverDone(false)
                  setRolloverResult(null); setInvoicesDone(false); setInvoicesCreated(0)
                  setEmailRows([]); setInvoiceRows([]); setEnrolments([]); setEndings({})
                }}
                className="border border-[#DEE7FF] text-[#325099]/60 text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#F0F4FF] transition"
              >
                Start new transition
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
