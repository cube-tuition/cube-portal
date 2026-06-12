'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS, T_PARENTS, T_TERMS } from '../../../lib/tables'
import { fmtDate } from '../../../lib/format'
import { registerUndoAction } from '../../../lib/undo'

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
  { id: 1, label: 'Setup',      icon: '📋' },
  { id: 2, label: 'Enrolments', icon: '👥' },
  { id: 3, label: 'Classes',    icon: '📚' },
  { id: 4, label: 'Done',       icon: '✅' },
]

const END_REASONS = [
  'Graduated / Year 12 finished',
  'Paused — may return next term',
  'Withdrew from tutoring',
  'Changed subject',
  'Other',
]

// ── Utility helpers ────────────────────────────────────────────────────────
const isoToday = () => new Date().toISOString().slice(0, 10)


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
    const prevStatus = nextTermStatus[enrolmentId] ?? 'pending'
    setNextTermStatus(prev => ({ ...prev, [enrolmentId]: status }))
    setEndings(prev => ({
      ...prev,
      [enrolmentId]: { ...prev[enrolmentId], ending: status === 'not_continuing' },
    }))
    await supabase.from(T_ENROLMENTS)
      .update({ next_term_status: status })
      .eq('id', enrolmentId)
    registerUndoAction(`transition status → "${status}"`, async () => {
      await supabase.from(T_ENROLMENTS).update({ next_term_status: prevStatus }).eq('id', enrolmentId)
      setNextTermStatus(prev => ({ ...prev, [enrolmentId]: prevStatus }))
      setEndings(prev => ({ ...prev, [enrolmentId]: { ...prev[enrolmentId], ending: prevStatus === 'not_continuing' } }))
    })
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goTo = async (nextStep) => {
    setError(null)
    if (nextStep === 2) await loadData()
    if (nextStep >= 3 && !dataLoaded) await loadData()
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

      setRolloverResult({
        createdClasses:    createdClassObjs.length,
        createdEnrolments,
        skipped,
        createdClassIds:   createdClassObjs.map(c => c.id),
        disenrolledIds:    [...endingIds],   // source enrolment IDs we flipped to disenrol
      })
      setRolloverDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Step 3: reset rollover ────────────────────────────────────────────────
  const resetRollover = async () => {
    if (!rolloverResult) return
    setSaving(true); setError(null)
    try {
      const { createdClassIds = [], disenrolledIds = [] } = rolloverResult

      // 1. Delete enrolments in the newly-created classes
      if (createdClassIds.length) {
        await supabase.from(T_ENROLMENTS).delete().in('class_id', createdClassIds)
      }

      // 2. Delete the newly-created classes themselves
      if (createdClassIds.length) {
        await supabase.from(T_CLASSES).delete().in('id', createdClassIds)
      }

      // 3. Restore source enrolments that were disenrolled during this rollover
      if (disenrolledIds.length) {
        await supabase.from(T_ENROLMENTS)
          .update({ status: 'active', next_term_status: 'confirmed', ended_at: null, end_reason: null })
          .in('id', disenrolledIds)

        // Sync local state so they show as confirmed again in Step 2
        setNextTermStatus(prev => {
          const next = { ...prev }
          disenrolledIds.forEach(id => { next[id] = 'confirmed' })
          return next
        })
        setEndings(prev => {
          const next = { ...prev }
          disenrolledIds.forEach(id => { next[id] = { ending: false, reason: '' } })
          return next
        })
      }

      setRolloverDone(false)
      setRolloverResult(null)
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
              <div className="bg-[#D1FAE5] border border-[#34D399] rounded-xl px-4 py-3.5 mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#065F46]">
                    ✓ Rollover complete — {rolloverResult.createdClasses} classes and {rolloverResult.createdEnrolments} enrolments created in {toTerm?.name}
                  </p>
                  {rolloverResult.skipped?.length > 0 && (
                    <p className="text-xs text-[#065F46]/70 mt-1">
                      Skipped (already existed): {rolloverResult.skipped.join(', ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={resetRollover}
                  disabled={saving}
                  className="flex-shrink-0 text-xs font-semibold text-red-600 border border-red-200 bg-white hover:bg-red-50 px-3 py-1.5 rounded-full transition disabled:opacity-40"
                >
                  {saving ? 'Resetting…' : '↩ Reset rollover'}
                </button>
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
                  Finish →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: Done ════════════════════════════════════════════════ */}
        {step === 4 && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-5xl mb-5">✅</div>
            <h2 className="text-xl font-bold text-[#062E63] mb-1">Transition complete</h2>
            <p className="text-sm text-[#325099]/60 mb-8">{fromTerm?.name} → {toTerm?.name}</p>

            <div className="grid grid-cols-2 gap-4 mb-10 text-left max-w-sm mx-auto">
              {[
                { label: 'Classes created',  value: rolloverResult?.createdClasses    ?? '—', icon: '📚' },
                { label: 'Students enrolled', value: rolloverResult?.createdEnrolments ?? '—', icon: '👥' },
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
                href={`/tutor/emails/term-start?termId=${toTermId}`}
                className="bg-[#062E63] text-white text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#325099] transition"
              >
                ✉ Send Term Start emails →
              </a>
              <a
                href="/tutor/classes"
                className="border border-[#DEE7FF] text-[#325099] text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#F0F4FF] transition"
              >
                View {toTerm?.name} classes
              </a>
              <button
                onClick={() => {
                  setStep(1); setDataLoaded(false); setRolloverDone(false)
                  setRolloverResult(null); setEnrolments([]); setEndings({})
                }}
                className="border border-[#DEE7FF] text-[#325099]/60 text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#F0F4FF] transition"
              >
                Start new transition
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── Revert a transition ──────────────────────────────────────────── */}
      <RevertPanel terms={terms} />
    </div>
  )
}

// ── Revert Panel ──────────────────────────────────────────────────────────────
function RevertPanel({ terms }) {
  const [open,       setOpen]       = useState(false)
  const [termId,     setTermId]     = useState('')
  const [preview,    setPreview]    = useState(null)  // { classes, enrolments, disenrolled }
  const [loading,    setLoading]    = useState(false)
  const [reverting,  setReverting]  = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState(null)
  const [confirm,    setConfirm]    = useState(false)

  const loadPreview = async (tid) => {
    if (!tid) { setPreview(null); return }
    setLoading(true); setError(null); setDone(false)
    try {
      const { data: cls } = await supabase.from(T_CLASSES).select('id, class_name').eq('term_id', tid)
      const classIds = (cls || []).map(c => c.id)

      let enrolments = 0
      if (classIds.length) {
        const { count } = await supabase.from(T_ENROLMENTS)
          .select('id', { count: 'exact', head: true })
          .in('class_id', classIds)
        enrolments = count || 0
      }

      // Find disenrolled enrolments in OTHER terms' classes that have next_term_status='not_continuing'
      // and ended_at set (likely marked during this transition)
      const term      = terms.find(t => t.id === tid)
      const fromTerms = terms.filter(t => t.start_date < term?.start_date)
      let disenrolled = []
      if (fromTerms.length) {
        const { data: fromCls } = await supabase.from(T_CLASSES)
          .select('id').in('term_id', fromTerms.map(t => t.id))
        const fromClassIds = (fromCls || []).map(c => c.id)
        if (fromClassIds.length) {
          const { data: dis } = await supabase.from(T_ENROLMENTS)
            .select('id, student_id, ended_at')
            .in('class_id', fromClassIds)
            .eq('status', 'disenrol')
            .not('ended_at', 'is', null)
          disenrolled = dis || []
        }
      }

      setPreview({ classes: cls || [], enrolments, disenrolled })
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const executeRevert = async () => {
    setConfirm(false); setReverting(true); setError(null)
    try {
      const classIds = preview.classes.map(c => c.id)

      // Delete enrolments in target term classes
      if (classIds.length) {
        await supabase.from(T_ENROLMENTS).delete().in('class_id', classIds)
      }
      // Delete target term classes
      if (classIds.length) {
        await supabase.from(T_CLASSES).delete().in('id', classIds)
      }
      // Restore disenrolled enrolments from preceding terms
      if (preview.disenrolled.length) {
        await supabase.from(T_ENROLMENTS)
          .update({ status: 'active', next_term_status: 'confirmed', ended_at: null, end_reason: null })
          .in('id', preview.disenrolled.map(d => d.id))
      }

      setDone(true); setPreview(null); setTermId('')
    } catch (e) { setError(e.message) }
    finally { setReverting(false) }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 pb-16">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-[#325099]/50 hover:text-[#325099] transition"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        Revert a transition
      </button>

      {open && (
        <div className="mt-4 bg-white border border-red-100 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-red-700 mb-1">Revert a term transition</h3>
          <p className="text-xs text-[#325099]/60 mb-5">
            Deletes all classes and enrolments in the selected term, and restores any students that were marked as not continuing. This cannot be undone.
          </p>

          <div className="flex gap-3 items-end mb-5">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-[#325099]/70 mb-1.5">Term to revert (delete)</label>
              <select
                value={termId}
                onChange={e => { setTermId(e.target.value); loadPreview(e.target.value); setDone(false) }}
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none"
              >
                <option value="">Select term…</option>
                {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {loading && <p className="text-xs text-[#325099]/50 mb-4">Loading…</p>}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 mb-4">{error}</div>}

          {done && (
            <div className="bg-[#D1FAE5] border border-[#34D399] text-[#065F46] text-sm font-semibold rounded-xl px-4 py-3 mb-4">
              ✓ Transition reverted successfully.
            </div>
          )}

          {preview && !done && (
            <div className="border border-red-100 rounded-xl overflow-hidden mb-5">
              <div className="bg-red-50 px-4 py-2.5 border-b border-red-100">
                <span className="text-xs font-semibold text-red-700">What will be deleted / restored</span>
              </div>
              <div className="px-4 py-3 space-y-1.5 text-xs text-[#325099]">
                <div className="flex justify-between">
                  <span>Classes deleted</span>
                  <span className="font-bold text-red-600">{preview.classes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Enrolments deleted</span>
                  <span className="font-bold text-red-600">{preview.enrolments}</span>
                </div>
                <div className="flex justify-between">
                  <span>Disenrolled students restored to active</span>
                  <span className="font-bold text-[#065F46]">{preview.disenrolled.length}</span>
                </div>
              </div>
              {preview.classes.length === 0 && (
                <div className="px-4 pb-3 text-xs text-[#325099]/50">No classes found in this term — nothing to revert.</div>
              )}
            </div>
          )}

          {preview && preview.classes.length > 0 && !done && (
            confirm ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-red-600 font-semibold">Are you sure? This cannot be undone.</span>
                <button onClick={executeRevert} disabled={reverting}
                  className="text-xs font-semibold bg-red-600 text-white px-4 py-1.5 rounded-full hover:bg-red-700 transition disabled:opacity-40">
                  {reverting ? 'Reverting…' : 'Yes, revert'}
                </button>
                <button onClick={() => setConfirm(false)} className="text-xs text-[#325099]/60 hover:text-[#325099]">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirm(true)}
                className="text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 px-5 py-2 rounded-full transition">
                ↩ Revert this transition
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
