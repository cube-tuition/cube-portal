'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../lib/terms'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS, T_PARENTS, T_TERMS, T_TERM_TRANSITIONS } from '../../../lib/tables'
import { fmtDate } from '../../../lib/format'

/*
 * Term Transition Wizard — /tutor/transition
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only. A 4-step checklist for moving from one term to the next:
 *
 *   1. Setup       — pick source + target terms
 *   2. Enrolments  — review who rolls over (everyone active/trial is copied;
 *                    disenrol or add students in the NEW term afterwards)
 *   3. Classes     — choose which classes to copy; execute rollover
 *                    (prices carry over with optional % fee increase)
 *   4. Done        — summary of everything created
 *
 * Re-runnable: the rollover skips classes already copied to the target term —
 * matched by provenance (classes.source_class_id) with class-name fallback.
 * Every run writes an audit row to term_transitions (who, when, what was
 * created); resetting a rollover marks that row cancelled.
 *
 * Re-enrolment emails: /tutor/emails/term-start.
 * New-term invoices: /tutor/accounting/invoices → Generate Draft Invoices.
 */

// ── Constants ──────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Setup',      icon: '📋' },
  { id: 2, label: 'Enrolments', icon: '👥' },
  { id: 3, label: 'Classes',    icon: '📚' },
  { id: 4, label: 'Done',       icon: '✅' },
]

// ── Utility helpers ────────────────────────────────────────────────────────


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

  // Step 2 (review only — everyone rolls over)
  const [enrolmentSearch, setEnrolmentSearch] = useState('')

  // Step 3
  const [selectedClasses, setSelectedClasses] = useState({})
  const [copyEnrolments, setCopyEnrolments]   = useState(true)
  const [feeIncreasePct, setFeeIncreasePct]   = useState('0')  // % applied to copied enrolment prices
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
    // Strictly term-scoped — an empty term shows 0, never "all classes ever".
    const { data: cls } = await supabase
      .from(T_CLASSES).select('id').eq('term_id', termId)
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
      // Strictly term-scoped. (The old "no matches → load ALL classes" fallback
      // is gone — it predated term-scoped classes and could offer to roll over
      // every class in history if an empty term was selected.)
      const clsQuery = await supabase
        .from(T_CLASSES)
        .select('*')
        .eq('term_id', fromTermId)
        .order('class_name')

      if (clsQuery.error) throw new Error(`Classes query failed: ${clsQuery.error.message}`)

      const cls = clsQuery.data || []

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
          price:        e.price ?? null,
          status:       e.status,               // trials roll over as trials
          student_name: s.full_name || '—',
          year:         s.year,
          class_name:   c.class_name || '—',
          class_day:    c.day_of_week || '',
          class_start:  c.start_time || '',
          class_end:    c.end_time || '',
          family_id:        s.family_id || null,
          parent_name:      p.full_name || '',
          parent_email:     p.email || '',
        }
      }).sort((a, b) => (a.class_name + a.student_name).localeCompare(b.class_name + b.student_name))

      setEnrolments(rows)
      setDataLoaded(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [fromTermId])

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

      const classesToRoll = classes.filter(c => selectedClasses[c.id])

      // Duplicate check: provenance first (source_class_id — rename-proof),
      // class name as fallback for classes created before provenance existed.
      const { data: existing } = await supabase
        .from(T_CLASSES).select('class_name, source_class_id').eq('term_id', toTermId)
      const existingNames   = new Set((existing || []).map(c => (c.class_name || '').toLowerCase()))
      const existingSources = new Set((existing || []).map(c => c.source_class_id).filter(Boolean))

      const skipped   = []
      let createdEnrolments = 0
      const createdClassObjs = []

      for (const origCls of classesToRoll) {
        if (existingSources.has(origCls.id) || existingNames.has((origCls.class_name || '').toLowerCase())) {
          skipped.push(origCls.class_name); continue
        }

        // Strip PK + auto columns before inserting; record provenance
        const { id: origId, created_at, source_class_id, ...clsFields } = origCls
        const { data: newCls, error: clsErr } = await supabase
          .from(T_CLASSES)
          .insert({ ...clsFields, term_id: toTermId, source_class_id: origId })
          .select().single()
        if (clsErr) throw clsErr
        createdClassObjs.push(newCls)

        if (copyEnrolments) {
          const pct = parseFloat(feeIncreasePct) || 0
          const adjust = (p) => (p === null || p === undefined)
            ? null
            : Math.round(Number(p) * (1 + pct / 100) * 100) / 100
          // Everyone rolls over — disenrol or add students in the NEW term
          // afterwards (there is no per-enrolment continuation tracking).
          const enrsForClass = enrolments.filter(e => e.class_id === origId)
          for (const e of enrsForClass) {
            const { error: enrErr } = await supabase
              .from(T_ENROLMENTS)
              .insert({
                student_id: e.student_id,
                class_id: newCls.id,
                status: e.status || 'active',    // trials stay trials
                price: adjust(e.price),          // carried over (+ optional % rise)
              })
            if (!enrErr) createdEnrolments++
          }
        }
      }

      // Audit record — who ran this rollover and what it created
      let auditId = null
      try {
        const { data: audit } = await supabase.from(T_TERM_TRANSITIONS).insert({
          from_term_id: fromTermId,
          to_term_id:   toTermId,
          run_by:       profile?.id ?? null,
          run_by_name:  profile?.full_name ?? null,
          meta: {
            classes_created:    createdClassObjs.length,
            enrolments_created: createdEnrolments,
            skipped,
            copy_enrolments:    copyEnrolments,
            fee_increase_pct:   parseFloat(feeIncreasePct) || 0,
          },
        }).select('id').single()
        auditId = audit?.id ?? null
      } catch { /* audit is best-effort — never block the rollover */ }

      setRolloverResult({
        createdClasses:    createdClassObjs.length,
        createdEnrolments,
        skipped,
        createdClassIds:   createdClassObjs.map(c => c.id),
        auditId,
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
      const { createdClassIds = [] } = rolloverResult

      // 1. Delete enrolments in the newly-created classes
      if (createdClassIds.length) {
        await supabase.from(T_ENROLMENTS).delete().in('class_id', createdClassIds)
      }

      // 2. Delete the newly-created classes themselves
      if (createdClassIds.length) {
        await supabase.from(T_CLASSES).delete().in('id', createdClassIds)
      }

      // Mark the audit record cancelled
      if (rolloverResult.auditId) {
        await supabase.from(T_TERM_TRANSITIONS)
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', rolloverResult.auditId)
      }

      setRolloverDone(false)
      setRolloverResult(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // (The old Step 5 invoice generator was removed — invoices for the new term
  // are created via /tutor/accounting/invoices → Generate Draft Invoices.)


  // ── Derived values ─────────────────────────────────────────────────────────
  const fromTerm          = terms.find(t => t.id === fromTermId)
  const toTerm            = terms.find(t => t.id === toTermId)
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
                  Everyone below rolls over into the new term (trials stay trials). After the rollover,
                  disenrol students who aren&apos;t continuing — or add new ones — directly in the new term.
                </p>
              </div>
              <div className="flex-shrink-0 flex gap-2 text-xs font-semibold pt-1">
                <span className="bg-[#EEF3FF] text-[#325099] px-2.5 py-1 rounded-full">{enrolments.length} rolling over</span>
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
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Student</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Yr</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Class</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#325099]/60">Status</th>
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
                        .map((e, i) => (
                          <tr key={e.id} className={`border-b border-[#DEE7FF] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}`}>
                            <td className="px-4 py-2.5 font-medium text-[#062E63]">{e.student_name}</td>
                            <td className="px-4 py-2.5 text-[#325099]/60 text-xs">Y{e.year}</td>
                            <td className="px-4 py-2.5 text-[#325099]/80 text-xs">{e.class_name}</td>
                            <td className="px-4 py-2.5">
                              {e.status === 'trial'
                                ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">Trial</span>
                                : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#D1FAE5] text-[#065F46]">Active</span>}
                            </td>
                          </tr>
                        ))}
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

            {/* Copy enrolments toggle + fee adjustment */}
            <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl">
              <label className="flex items-center gap-3 cursor-pointer select-none flex-1 min-w-[260px]">
                <input
                  type="checkbox"
                  checked={copyEnrolments}
                  onChange={e => setCopyEnrolments(e.target.checked)}
                  className="accent-[#062E63] w-4 h-4"
                />
                <div>
                  <span className="text-sm font-semibold text-[#062E63]">Copy enrolments to new classes</span>
                  <span className="text-xs text-[#325099]/50 ml-2">(all {enrolments.length} roll over — trials stay trials)</span>
                  <p className="text-[11px] text-[#325099]/50 mt-0.5">Prices carry over automatically. Disenrol non-continuing students in the new term afterwards.</p>
                </div>
              </label>
              {copyEnrolments && (
                <label className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold text-[#062E63]">Fee increase</span>
                  <input
                    type="number"
                    step="0.5"
                    min="-50"
                    max="100"
                    value={feeIncreasePct}
                    onChange={e => setFeeIncreasePct(e.target.value)}
                    className="w-20 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm text-right text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
                  />
                  <span className="text-xs font-semibold text-[#325099]/60">%</span>
                  {parseFloat(feeIncreasePct) > 0 && (
                    <span className="text-[10px] text-[#325099]/50">e.g. $650 → ${(650 * (1 + (parseFloat(feeIncreasePct) || 0) / 100)).toFixed(2)}</span>
                  )}
                </label>
              )}
            </div>

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
                const carrying = enrolments.filter(e => e.class_id === c.id).length
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
              <Link
                href={`/tutor/emails/term-start?termId=${toTermId}`}
                className="bg-[#062E63] text-white text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#325099] transition"
              >
                ✉ Send Term Start emails →
              </Link>
              <Link
                href="/tutor/classes"
                className="border border-[#DEE7FF] text-[#325099] text-sm font-semibold px-6 py-2.5 rounded-full hover:bg-[#F0F4FF] transition"
              >
                View {toTerm?.name} classes
              </Link>
              <button
                onClick={() => {
                  setStep(1); setDataLoaded(false); setRolloverDone(false)
                  setRolloverResult(null); setEnrolments([])
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
