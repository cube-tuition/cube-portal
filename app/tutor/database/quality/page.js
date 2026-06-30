'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { T_STUDENTS, T_PARENTS, T_TUTORS, T_ADMINS, T_CLASSES, T_ENROLMENTS, T_LESSONS, T_INVOICES, T_TRIAL_SUBMISSIONS } from '../../../../lib/tables'
import { TABLE_META, validateValue } from '../../../../lib/tableMeta'

/*
 * Admin-only: Data Quality — /tutor/database/quality
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY health checks over the operational tables. Surfaces warnings;
 * never modifies data. Fix issues via the Database Explorer.
 */

const SEVERITY_STYLE = {
  high:   'bg-rose-50 border-rose-200 text-rose-800',
  medium: 'bg-amber-50 border-amber-200 text-amber-800',
  low:    'bg-blue-50 border-blue-200 text-blue-800',
}
const SEVERITY_DOT = { high: 'bg-rose-500', medium: 'bg-amber-400', low: 'bg-blue-400' }

function norm(s) { return (s ?? '').trim().toLowerCase() }

export default function DataQualityPage() {
  const router = useRouter()
  const [staff, setStaff]     = useState(null)
  const [running, setRunning] = useState(false)
  const [ranAt, setRanAt]     = useState(null)
  const [issues, setIssues]   = useState([])
  const [error, setError]     = useState(null)

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.push('/tutor'); return }
      setStaff(profile)
    })()
  }, [router])

  const runChecks = async () => {
    setRunning(true); setError(null)
    const found = []
    const add = (severity, group, message, detail) => found.push({ severity, group, message, detail })

    try {
      const [students, guardians, tutors, directors, classes, enrolments, invoices, trials] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, email, phone, school, year, gender, status, family_id'),
        supabase.from(T_PARENTS).select('id, full_name, email, phone, relationship, student_id'),
        supabase.from(T_TUTORS).select('id, full_name'),
        supabase.from(T_ADMINS).select('id, full_name'),
        supabase.from(T_CLASSES).select('id, class_name, teacher, day_of_week, term_id, course_id'),
        supabase.from(T_ENROLMENTS).select('id, student_id, class_id, status, price'),
        supabase.from(T_INVOICES).select('id, term_id, family_id, student_id, status, payment_status'),
        supabase.from(T_TRIAL_SUBMISSIONS).select('id, student_name, parent_email, parent_phone, status'),
      ])
      for (const r of [students, guardians, tutors, directors, classes, enrolments, invoices, trials]) {
        if (r.error) throw new Error(r.error.message)
      }
      const S = students.data ?? [], G = guardians.data ?? [], TU = tutors.data ?? [], DIR = directors.data ?? []
      const C = classes.data ?? [], E = enrolments.data ?? [], I = invoices.data ?? [], TR = trials.data ?? []
      const studentIds  = new Set(S.map(s => s.id))
      const studentById = Object.fromEntries(S.map(s => [s.id, s.full_name]))
      const classIds    = new Set(C.map(c => c.id))
      // Staff teach under free-text names in classes.teacher — usually a first
      // name ("Daniel" for "Daniel Leem"), and some teachers are directors, not
      // tutors. Accept a teacher if it matches any staff member's full name OR
      // first name across both tutors and directors.
      const staffNames = new Set()
      for (const p of [...TU, ...DIR]) {
        const full = norm(p.full_name)
        if (!full) continue
        staffNames.add(full)
        staffNames.add(full.split(/\s+/)[0])   // first name
      }

      // ── Duplicates ──────────────────────────────────────────────────────────
      const nameCount = {}
      for (const s of S) { const k = norm(s.full_name); if (k) nameCount[k] = (nameCount[k] ?? []).concat(s.full_name) }
      for (const [k, names] of Object.entries(nameCount)) if (names.length > 1)
        add('high', 'Duplicates', `Possible duplicate students: "${names[0]}" appears ${names.length} times.`)
      // Guardians are stored per student, so siblings legitimately repeat the same
      // parent. Only flag: (a) the same guardian twice on ONE student, or
      // (b) the same guardian across students who aren't linked as a family.
      const familyOf = Object.fromEntries(S.map(s => [s.id, s.family_id]))
      const gGroups = {}
      for (const g of G) {
        const k = `${norm(g.full_name)}|${norm(g.email)}`
        if (norm(g.full_name)) (gGroups[k] = gGroups[k] ?? []).push(g)
      }
      for (const grp of Object.values(gGroups)) {
        if (grp.length < 2) continue
        const name = grp[0].full_name
        const studentIdsOfGroup = grp.map(g => String(g.student_id))
        if (new Set(studentIdsOfGroup).size < studentIdsOfGroup.length) {
          add('high', 'Duplicates', `Guardian "${name}" is listed more than once on the same student.`)
          continue
        }
        const fams = [...new Set(studentIdsOfGroup.map(sid => familyOf[sid]))]
        if (fams.length > 1 || fams[0] === null || fams[0] === undefined) {
          const studentNames = studentIdsOfGroup.map(sid => studentById[sid] ?? sid).join(', ')
          add('low', 'Family links', `Guardian "${name}" appears on ${grp.length} students (${studentNames}) who aren't linked as one family — if they're siblings, link them via the Siblings column so discounts and invoicing group correctly.`)
        }
        // same non-null family on all students → siblings sharing a parent: expected, no warning
      }

      // ── Orphans / broken links ──────────────────────────────────────────────
      for (const g of G) if (!g.student_id || !studentIds.has(String(g.student_id)))
        add('high', 'Orphans', `Guardian "${g.full_name ?? g.id}" is not linked to any existing student.`, `guardians.id=${g.id}`)
      for (const e of E) {
        if (!e.student_id) add('high', 'Orphans', `Enrolment #${e.id} has no student.`, `enrolments.id=${e.id}`)
        else if (!studentIds.has(e.student_id)) add('high', 'Orphans', `Enrolment #${e.id} points to a missing student.`)
        if (!e.class_id) add('high', 'Orphans', `Enrolment #${e.id} has no class.`, `enrolments.id=${e.id}`)
        else if (!classIds.has(e.class_id)) add('high', 'Orphans', `Enrolment #${e.id} points to a missing class.`)
      }

      // ── Invalid emails / phones (via tableMeta validators) ──────────────────
      for (const s of S) {
        const w = s.email && validateValue(T_STUDENTS, 'email', s.email)
        if (w) add('medium', 'Invalid contacts', `Student "${s.full_name}": ${w}`)
        const wp = s.phone && validateValue(T_STUDENTS, 'phone', s.phone)
        if (wp) add('low', 'Invalid contacts', `Student "${s.full_name}": ${wp}`)
      }
      for (const g of G) {
        const w = g.email && validateValue(T_PARENTS, 'email', g.email)
        if (w) add('medium', 'Invalid contacts', `Guardian "${g.full_name ?? g.id}": ${w}`)
        const wp = g.phone && validateValue(T_PARENTS, 'phone', g.phone)
        if (wp) add('low', 'Invalid contacts', `Guardian "${g.full_name ?? g.id}": ${wp}`)
      }
      for (const t of TR) {
        const w = t.parent_email && validateValue(T_TRIAL_SUBMISSIONS, 'parent_email', t.parent_email)
        if (w) add('low', 'Invalid contacts', `Trial enquiry "${t.student_name}": ${w}`)
      }

      // ── Empty string vs NULL ────────────────────────────────────────────────
      for (const s of S) {
        const emptyFields = ['email','phone','school','year'].filter(f => s[f] === '')
        if (emptyFields.length) add('low', 'Empty vs NULL', `Student "${s.full_name}" has empty-string (not NULL) values in: ${emptyFields.join(', ')}. Filters treating blank as NULL will miss these.`)
      }

      // ── Off-list / inconsistent select values ───────────────────────────────
      const checkSelect = (rows, table, col, labelOf) => {
        const meta = TABLE_META[table]?.columns?.[col]
        if (!meta || meta.type !== 'singleSelect') return
        for (const r of rows) {
          const v = r[col]
          if (v === null || v === undefined || v === '') continue
          if (!meta.options.includes(String(v))) {
            const shown = JSON.stringify(String(v))
            add('medium', 'Inconsistent values', `${labelOf(r)} — ${table}.${col} = ${shown} is not an expected value (${meta.options.join(', ')}).`)
          }
        }
      }
      checkSelect(S, T_STUDENTS, 'year',   r => `Student "${r.full_name}"`)
      checkSelect(S, T_STUDENTS, 'gender', r => `Student "${r.full_name}"`)
      checkSelect(S, T_STUDENTS, 'status', r => `Student "${r.full_name}"`)
      checkSelect(E, T_ENROLMENTS, 'status', r => `Enrolment of "${studentById[r.student_id] ?? '#'+r.id}"`)
      checkSelect(C, T_CLASSES, 'day_of_week', r => `Class "${r.class_name}"`)
      checkSelect(I, T_INVOICES, 'status', r => `Invoice #${r.id}`)
      checkSelect(G, T_PARENTS, 'relationship', r => `Guardian "${r.full_name ?? r.id}"`)

      // ── Missing required fields ─────────────────────────────────────────────
      for (const s of S) {
        if (!s.full_name?.trim()) add('high', 'Missing required', `Student ${s.id} has no name.`)
        if (!s.year || !String(s.year).trim()) add('medium', 'Missing required', `Student "${s.full_name}" has no year level.`)
      }
      for (const c of C) {
        if (!c.term_id)   add('medium', 'Missing required', `Class "${c.class_name}" has no term.`)
        if (!c.course_id) add('medium', 'Missing required', `Class "${c.class_name}" has no course.`)
      }

      // ── Free-text teacher names not matching any staff record ───────────────
      const unmatched = [...new Set(C.filter(c => c.teacher && !staffNames.has(norm(c.teacher))).map(c => c.teacher))]
      if (unmatched.length)
        add('low', 'Unlinked references', `${unmatched.length} class teacher name(s) have no matching staff record: ${unmatched.join(', ')}. Add them as a tutor (or director), or correct the class's Teacher field.`)

      // ── Duplicate live invoices (one per family/student per term expected) ──
      const invKey = {}
      for (const inv of I) {
        if (inv.status === 'voided') continue
        const who = inv.family_id !== null && inv.family_id !== undefined ? `family #${inv.family_id}` : `student ${studentById[inv.student_id] ?? inv.student_id ?? '?'}`
        const k = `${inv.term_id}|${who}`
        ;(invKey[k] = invKey[k] ?? []).push(inv.id)
      }
      for (const [k, ids] of Object.entries(invKey)) if (ids.length > 1)
        add('high', 'Duplicate invoices', `${k.split('|')[1]} has ${ids.length} live invoices for the same term (ids: ${ids.join(', ')}) — there should be one. Void the stale ones in the invoices page.`)

      // ── Family linkage ──────────────────────────────────────────────────────
      const noFamily = S.filter(s => s.family_id === null && s.status === 'active').length
      if (noFamily) add('low', 'Family links', `${noFamily} active student(s) have no family number — sibling discounts and family invoicing won't group them.`)
      const famIds = new Set(S.map(s => s.family_id).filter(v => v !== null))
      for (const inv of I) if (inv.family_id !== null && !famIds.has(inv.family_id))
        add('medium', 'Family links', `Invoice #${inv.id} references family #${inv.family_id} which no student belongs to.`)

      setIssues(found)
      setRanAt(new Date())
    } catch (err) {
      setError(err.message || 'Checks failed.')
    } finally { setRunning(false) }
  }

  if (!staff) return <div className="min-h-screen bg-[#F8FAFF]" />

  const groups = [...new Set(issues.map(i => i.group))]
  const counts = { high: issues.filter(i => i.severity === 'high').length, medium: issues.filter(i => i.severity === 'medium').length, low: issues.filter(i => i.severity === 'low').length }

  return (
    <div className="min-h-screen bg-[#F8FAFF] flex flex-col">
      <TutorNav staffName={staff.full_name} isAdmin={true} />
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-1">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Admin · Database</p>
            <h1 className="text-xl font-bold text-[#2A2035] font-display">Data Quality</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push('/tutor/database')} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">← Explorer</button>
            <button onClick={runChecks} disabled={running} className="px-4 py-1.5 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
              {running ? 'Running…' : ranAt ? '↻ Re-run checks' : '▶ Run checks'}
            </button>
          </div>
        </div>
        <p className="text-xs text-[#2A2035]/50 mb-6">
          Read-only health checks: duplicates, orphaned links, invalid emails/phones, inconsistent values.
          Nothing is changed automatically — fix issues in the Database Explorer.
        </p>

        {error && <div className="mb-4 px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">{error}</div>}

        {ranAt && !running && (
          <div className="flex items-center gap-3 mb-5 text-xs">
            <span className="text-[#2A2035]/40">Checked {ranAt.toLocaleTimeString()} —</span>
            {issues.length === 0
              ? <span className="font-semibold text-emerald-700">No issues found 🎉</span>
              : <>
                  {counts.high   > 0 && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">{counts.high} high</span>}
                  {counts.medium > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{counts.medium} medium</span>}
                  {counts.low    > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">{counts.low} low</span>}
                </>
            }
          </div>
        )}

        {groups.map(group => (
          <section key={group} className="mb-6">
            <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-[#325099] mb-2">{group}</h2>
            <div className="space-y-1.5">
              {issues.filter(i => i.group === group).map((i, idx) => (
                <div key={idx} className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs ${SEVERITY_STYLE[i.severity]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[i.severity]}`} />
                  <div className="min-w-0">
                    <p className="font-medium">{i.message}</p>
                    {i.detail && <p className="opacity-60 font-mono text-[10px] mt-0.5">{i.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {!ranAt && !running && (
          <div className="border border-dashed border-[#DEE7FF] rounded-2xl px-6 py-12 text-center text-xs text-[#2A2035]/40">
            Press <span className="font-semibold text-[#325099]">Run checks</span> to scan students, guardians, classes, enrolments, invoices and trial enquiries.
          </div>
        )}
      </main>
    </div>
  )
}
