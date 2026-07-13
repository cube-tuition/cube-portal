'use client'
import { authedFetch } from '../../../../lib/authedFetch'
import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getEnrolmentTerm } from '../../../../lib/terms'
import { fmtMoney, fmtDate, fmtDateLong } from '../../../../lib/format'
import { generateInvoicePdf } from '../../../../lib/invoicePdf'
import { XeroBanner } from '../../../../components/invoices/XeroBanner'
import { AddCreditModal } from '../../../../components/invoices/AddCreditModal'
import { ReferralModal } from '../../../../components/invoices/ReferralModal'
import { TopUpInvoiceModal } from '../../../../components/invoices/TopUpInvoiceModal'
import { buildEmailBody, SendEmailModal } from '../../../../components/invoices/SendEmailModal'

/*
 * Invoice Dashboard — /tutor/accounting/invoices
 * Phase 1: draft generation, warnings, approve, generate + download PDF
 */

// Workflow stage
const STAGE_LABELS = {
  draft:          { label: 'Draft',    cls: 'bg-[#F0F4FF] text-[#325099]' },
  approved:       { label: 'Approved', cls: 'bg-[#EDE9FE] text-[#5B21B6]' },
  synced_to_xero: { label: 'In Xero', cls: 'bg-[#ECFDF5] text-[#065F46]' },
  voided:         { label: 'Voided',  cls: 'bg-[#F3F4F6] text-gray-500' },
}
// Delivery
const DELIVERY_LABELS = {
  unsent: { label: 'Unsent', cls: 'bg-[#F3F4F6] text-gray-500' },
  sent:   { label: 'Sent',   cls: 'bg-[#D1FAE5] text-[#065F46]' },
}
// Payment
const PAYMENT_LABELS = {
  unpaid:  { label: 'Unpaid',  cls: 'bg-[#FEF3C7] text-[#92400E]' },
  paid:    { label: 'Paid',    cls: 'bg-[#D1FAE5] text-[#065F46] font-bold' },
  overdue: { label: 'Overdue', cls: 'bg-[#FEE2E2] text-red-700 font-bold' },
}
// Keep for backwards compat badge display
const STATUS_LABELS = { ...STAGE_LABELS, ...DELIVERY_LABELS, ...PAYMENT_LABELS }

// Dropdown colour classes (background + text + border for the select element itself)
const STAGE_SELECT_CLS = {
  draft:          'bg-[#F0F4FF] text-[#325099] border-[#C7D5F8]',
  approved:       'bg-[#EDE9FE] text-[#5B21B6] border-[#C4B5FD]',
  synced_to_xero: 'bg-[#ECFDF5] text-[#065F46] border-[#6EE7B7]',
  voided:         'bg-[#F3F4F6] text-gray-500  border-[#D1D5DB]',
}
const DELIVERY_SELECT_CLS = {
  unsent: 'bg-[#F3F4F6] text-gray-500  border-[#D1D5DB]',
  sent:   'bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]',
}
const PAYMENT_SELECT_CLS = {
  '':      'bg-[#F3F4F6] text-gray-400  border-[#D1D5DB]',
  unpaid:  'bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]',
  paid:    'bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]',
  overdue: 'bg-[#FEE2E2] text-red-700   border-[#FCA5A5]',
}


function Warning({ text }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE047] px-2 py-0.5 rounded-full">
      ⚠ {text}
    </span>
  )
}

function getWarnings(inv, prevUnpaid) {
  const w = []
  if (!inv.parent_email)                              w.push('missing email')
  if (!inv.invoice_number)                            w.push('no invoice number')
  if ((inv.total || 0) <= 0)                         w.push('zero/negative total')
  if (inv.status !== 'voided' && prevUnpaid)          w.push('unpaid previous invoice')
  const missingFee  = (inv.line_items || []).filter(l => l.type === 'enrolment' && !l.unit_price)
  if (missingFee.length)                              w.push(`${missingFee.length} missing fee`)
  const missingTime = (inv.line_items || []).filter(l => l.type === 'enrolment' && !l.start_time)
  if (missingTime.length)                             w.push(`${missingTime.length} missing time`)
  const creditTotal = (inv.line_items || []).filter(l => l.type === 'credit').reduce((s, l) => s + Math.abs(l.amount || 0), 0)
  if (creditTotal > (inv.subtotal || 0) * 0.5 && creditTotal > 50) w.push('unusual credit')
  return w
}

// Order credit lines: dated ones (absences — "… on Tuesday 23 Jun 2026") first,
// chronologically, then undated credits (referral rewards etc.) in saved order.
const CREDIT_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
function creditLineDate(reason) {
  const m = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i.exec(reason || '')
  return m ? new Date(Number(m[3]), CREDIT_MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1])).getTime() : null
}
function sortCreditLines(lines) {
  return [...lines].sort((a, b) => {
    const da = creditLineDate(a.reason), db = creditLineDate(b.reason)
    if (da != null && db != null) return da - db
    if (da != null) return -1
    if (db != null) return 1
    return 0
  })
}


export default function InvoiceDashboard() {
  return <Suspense><InvoiceDashboardInner /></Suspense>
}

function InvoiceDashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile,    setProfile]    = useState(null)
  const [terms,      setTerms]      = useState([])
  const [termId,     setTermId]     = useState('')
  const [invoices,   setInvoices]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [generating, setGenerating] = useState(false)
  const [approvingId, setApprovingId] = useState(null)
  const [pdfGenId,   setPdfGenId]   = useState(null)
  const [regenAll,   setRegenAll]   = useState(false)
  const [regenProgress, setRegenProgress] = useState({ done: 0, total: 0 })
  const [error,      setError]      = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)
  const [creditModal,   setCreditModal]   = useState(null)  // { invoiceId, members }
  const [referralModal, setReferralModal] = useState(false)
  const [topUpModal,    setTopUpModal]    = useState(null)  // invoice object
  const [allStudents,   setAllStudents]   = useState([])
  const [statusEditing,   setStatusEditing]   = useState(null)
  const [confirmUnsentId,   setConfirmUnsentId]   = useState(null) // invoice id pending unsent confirmation
  const [confirmPaidInv,    setConfirmPaidInv]    = useState(null) // invoice object pending paid confirmation
  const [sendModalInv,      setSendModalInv]      = useState(null)
  const [reminderModalInv,  setReminderModalInv]  = useState(null)
  const [emailTemplate,     setEmailTemplate]     = useState('')
  const [emailSubjectTmpl,  setEmailSubjectTmpl]  = useState('')
  const [mainTab,           setMainTab]           = useState('invoices') // 'invoices' | 'credits' | 'template'
  const [heldCredits,       setHeldCredits]       = useState([])
  const [creditsLoading,    setCreditsLoading]    = useState(false)
  const [tmplSaving,        setTmplSaving]        = useState(false)
  const [tmplSaved,         setTmplSaved]         = useState(false)
  const [addCreditModal,    setAddCreditModal]    = useState(false)
  const [addCreditForm,     setAddCreditForm]     = useState({ studentId: '', amount: '', reason: '' })
  const [addCreditSearch,   setAddCreditSearch]   = useState('')
  const [addCreditSaving,   setAddCreditSaving]   = useState(false)
  const [addCreditReasonType,    setAddCreditReasonType]    = useState('')   // 'absence' | 'other' | ''
  const [addCreditOtherReason,   setAddCreditOtherReason]   = useState('')
  const [addCreditLessons,       setAddCreditLessons]       = useState([])
  const [addCreditLessonsLoading,setAddCreditLessonsLoading]= useState(false)
  const [addCreditSelectedLesson,setAddCreditSelectedLesson]= useState(null)
  const [filterTab,             setFilterTab]             = useState('all')

  // Xero
  const [xeroConnected, setXeroConnected] = useState(null)  // null=loading, true, false
  const [xeroSyncing,   setXeroSyncing]   = useState(false)
  const [xeroResult,    setXeroResult]    = useState(null)  // { pushed, skipped, errors }

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(profile)
    })
    fetchAllTerms().then(allTerms => {
      setTerms(allTerms)
      const cur = getEnrolmentTerm(allTerms)
      if (cur) setTermId(cur.id)
    })
    supabase.from('portal_settings')
      .select('key, value')
      .in('key', ['invoice_email_template', 'invoice_email_subject'])
      .then(({ data }) => {
        if (data) {
          const map = Object.fromEntries(data.map(r => [r.key, r.value]))
          if (map.invoice_email_template) setEmailTemplate(map.invoice_email_template)
          if (map.invoice_email_subject)  setEmailSubjectTmpl(map.invoice_email_subject)
        }
      })
  }, [router])

  // Check Xero connection + handle OAuth callback redirect
  useEffect(() => {
    const xeroParam = searchParams.get('xero')
    if (xeroParam === 'connected') setXeroConnected(true)
    else if (xeroParam === 'error') setError('Xero connection failed — please try again.')

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch('/api/xero/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).then(r => r.json()).then(d => setXeroConnected(d.connected)).catch(() => setXeroConnected(false))
    })
  }, [searchParams])

  const handleSyncToXero = async () => {
    if (!termId) return
    setXeroSyncing(true); setXeroResult(null); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res  = await fetch('/api/xero/push', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body:    JSON.stringify({ term_id: termId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setXeroResult(data)
      await loadInvoices()
    } catch (e) { setError('Xero sync failed: ' + e.message) }
    finally { setXeroSyncing(false) }
  }

  const term = terms.find(t => t.id === termId)

  const loadInvoices = useCallback(async () => {
    if (!termId) return
    setLoading(true); setError(null)
    try {
      // Load classes for this term
      const { data: classes } = await supabase
        .from('classes').select('id, class_name, day_of_week, start_time, teacher').eq('term_id', termId)
      const classMap = Object.fromEntries((classes || []).map(c => [c.id, c]))
      const classIds = (classes || []).map(c => c.id)

      // Load invoices for this term
      const { data: invs, error: invErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('term_id', termId)
        .not('status', 'eq', 'voided')
        .order('invoice_number', { ascending: true })
      if (invErr) throw invErr

      // For legacy invoices (no line_items), load enrolments directly
      const legacyInvs = (invs || []).filter(i => !i.line_items?.length)
      let legacyEnrolMap = {} // student_id[] per invoice id
      let legacyStudMap  = {} // student by id

      if (legacyInvs.length && classIds.length) {
        const { data: enrs } = await supabase
          .from('enrolments').select('id, student_id, class_id, price, status')
          .in('class_id', classIds).in('status', ['active', 'trial'])
        const { data: studs } = await supabase
          .from('students').select('id, full_name, family_id')
          .in('id', (enrs || []).map(e => e.student_id))
        legacyStudMap = Object.fromEntries((studs || []).map(s => [s.id, s]))

        // Map family_id → enrolments for legacy invoices
        for (const inv of legacyInvs) {
          const matchedEnrs = (enrs || []).filter(e => {
            const s = legacyStudMap[e.student_id]
            return inv.family_id ? s?.family_id === inv.family_id : e.student_id === inv.student_id
          })
          legacyEnrolMap[inv.id] = matchedEnrs
        }
      }

      // Collect all relevant student IDs
      const allStudentIds = [...new Set([
        ...(invs || []).flatMap(inv => {
          if (inv.student_id) return [inv.student_id]
          return (inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id)
        }),
        ...Object.values(legacyEnrolMap).flat().map(e => e.student_id),
      ])]

      const { data: guardians } = allStudentIds.length
        ? await supabase.from('guardians').select('student_id, full_name, email, phone').in('student_id', allStudentIds)
        : { data: [] }
      const guardianMap = Object.fromEntries((guardians || []).map(g => [g.student_id, g]))

      // Load previous unpaid invoices
      const familyIds = (invs || []).map(i => i.family_id).filter(Boolean)
      let prevUnpaidSet = new Set()
      if (familyIds.length) {
        const { data: prevInvs } = await supabase
          .from('invoices').select('family_id')
          .in('family_id', familyIds)
          .in('payment_status', ['unpaid', 'overdue'])
          .neq('term_id', termId)
        for (const p of prevInvs || []) prevUnpaidSet.add(p.family_id)
      }

      // Enrich invoices — handle both new (line_items) and legacy formats
      const enriched = (invs || []).map(inv => {
        const isLegacy = !inv.line_items?.length

        // Build line_items for legacy invoices on the fly
        const effectiveLineItems = isLegacy
          ? (legacyEnrolMap[inv.id] || []).map(e => ({
              type:         'enrolment',
              student_id:   e.student_id,
              student_name: legacyStudMap[e.student_id]?.full_name || '—',
              class_id:     e.class_id,
              class_name:   classMap[e.class_id]?.class_name || '—',
              day:          classMap[e.class_id]?.day_of_week || '',
              start_time:   classMap[e.class_id]?.start_time || '',
              teacher:      classMap[e.class_id]?.teacher || '',
              unit_price:   parseFloat(e.price) || 0,
              amount:       parseFloat(e.price) || 0,
            })).concat(
              // Add stored discount line items for legacy invoices
              inv.sibling_discount > 0
                ? [{ type: 'discount', reason: `Sibling discount`, amount: -parseFloat(inv.sibling_discount) }]
                : []
            ).concat(
              inv.multi_course_discount > 0
                ? [{ type: 'discount', reason: `Multi-course discount`, amount: -parseFloat(inv.multi_course_discount) }]
                : []
            )
          : (inv.line_items || [])

        const enrolStudentIds = effectiveLineItems.filter(l => l.type === 'enrolment').map(l => l.student_id)
        const firstStudentId  = inv.student_id || enrolStudentIds[0]
        const guardian        = guardianMap[firstStudentId] || {}
        const studentNames    = [...new Set(effectiveLineItems.filter(l => l.type === 'enrolment').map(l => l.student_name))]

        return {
          ...inv,
          line_items:   effectiveLineItems,
          parent_name:  guardian.full_name || '—',
          parent_email: guardian.email     || '',
          parent_phone: guardian.phone     || '',
          student_names: studentNames,
          prev_unpaid:  prevUnpaidSet.has(inv.family_id),
          is_legacy:    isLegacy,
        }
      })

      // Auto-set overdue: any unpaid invoice whose due_date is in the past
      const today = new Date().toISOString().slice(0, 10)
      const nowOverdue = enriched.filter(
        i => i.payment_status === 'unpaid' && i.due_date && i.due_date < today
      )
      if (nowOverdue.length) {
        const ids = nowOverdue.map(i => i.id)
        await supabase
          .from('invoices')
          .update({ payment_status: 'overdue' })
          .in('id', ids)
        setInvoices(enriched.map(i =>
          ids.includes(i.id) ? { ...i, payment_status: 'overdue' } : i
        ))
      } else {
        setInvoices(enriched)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [termId])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  useEffect(() => {
    if (mainTab !== 'credits') return
    setCreditsLoading(true)
    supabase
      .from('student_credits')
      .select('id, student_id, amount, reason, notes, created_at, students(full_name, year, school, family_id)')
      .is('invoice_id', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setHeldCredits(data || [])
        setCreditsLoading(false)
      })
  }, [mainTab])

  // Load all students for referral modal
  useEffect(() => {
    supabase.from('students').select('id, full_name').order('full_name').then(({ data }) => setAllStudents(data || []))
  }, [])

  // Load lessons for absence credit picker: the student's PAST lessons across
  // their active enrolments (an absence is always in the past — the page's
  // selected term may be the upcoming one with no lessons yet).
  useEffect(() => {
    if (!addCreditModal || addCreditReasonType !== 'absence' || !addCreditForm.studentId) {
      setAddCreditLessons([]); setAddCreditSelectedLesson(null); return
    }
    setAddCreditLessonsLoading(true)
    ;(async () => {
      const { data: enrols } = await supabase
        .from('enrolments')
        .select('class_id, price, classes(id, class_name, day_of_week, term_id)')
        .eq('student_id', addCreditForm.studentId)
        .eq('status', 'active')
      const classIds = (enrols || []).map(e => e.class_id)
      if (!classIds.length) { setAddCreditLessons([]); setAddCreditLessonsLoading(false); return }

      // All lessons for those classes (for per-lesson price), excluding makeups
      const { data: lessons } = await supabase
        .from('lessons')
        .select('id, lesson_date, class_id, classes(class_name)')
        .in('class_id', classIds)
        .eq('is_makeup', false)
        .order('lesson_date', { ascending: false })

      // Count lessons per class for per-lesson price calculation
      const lessonCountByClass = {}
      for (const l of lessons || []) {
        lessonCountByClass[l.class_id] = (lessonCountByClass[l.class_id] || 0) + 1
      }
      const enrolByClass = Object.fromEntries((enrols || []).map(e => [e.class_id, e]))

      // Offer only lessons that have already happened, most recent first
      const today = new Date().toISOString().slice(0, 10)
      const enriched = (lessons || []).filter(l => l.lesson_date <= today).map(l => {
        const enrol = enrolByClass[l.class_id]
        const lessonCount = lessonCountByClass[l.class_id] || 1
        const perLesson = enrol?.price != null ? Math.round((parseFloat(enrol.price) / lessonCount) * 100) / 100 : null
        return { ...l, perLesson }
      })
      setAddCreditLessons(enriched)
      setAddCreditLessonsLoading(false)
    })()
  }, [addCreditModal, addCreditReasonType, addCreditForm.studentId])

  // ── Credit handler ────────────────────────────────────────────────────────
  const handleAddCredit = async ({ invoiceId, studentId, amount, reason, notes }) => {
    const amt = Number(amount)
    const { error: err } = await supabase.from('student_credits').insert({
      student_id: studentId, amount: amt, reason,
      notes: notes?.trim() || null, invoice_id: invoiceId,
    })
    if (err) { setError('Failed to add credit: ' + err.message); return }
    const inv = invoices.find(i => i.id === invoiceId)
    if (inv) {
      // Show the credit as its own line (like the discount lines), then recompute
      // the total from the line items so the breakdown matches the total.
      const REASON_LABELS = { missed_lesson: 'Missed lesson', late_start: 'Late start', other: 'Adjustment' }
      const who   = (inv.line_items || []).find(l => l.student_id === studentId)?.student_name?.split(' ')[0]
      const label = `${REASON_LABELS[reason] || 'Adjustment'}${notes?.trim() ? ' — ' + notes.trim() : ''}${who ? ' (' + who + ')' : ''}`
      const newLineItems = [...(inv.line_items || []), { type: 'credit', reason: label, amount: -amt }]
      const newTotal = Math.max(0, newLineItems.reduce((s, l) => s + (Number(l.amount) || 0), 0))
      await supabase.from('invoices').update({ line_items: newLineItems, subtotal: newTotal, total: newTotal }).eq('id', invoiceId)
    }
    setCreditModal(null)
    await loadInvoices()
  }

  // ── Manual credit balance handler ─────────────────────────────────────────
  const handleSaveManualCredit = async () => {
    const { studentId, amount } = addCreditForm
    const finalReason = addCreditReasonType === 'absence'
      ? addCreditForm.reason   // auto-generated when lesson was selected
      : addCreditOtherReason.trim()
    if (!studentId || !amount || !finalReason) return
    setAddCreditSaving(true)
    const { error: err } = await supabase.from('student_credits').insert({
      student_id: studentId, amount: Number(amount), reason: finalReason, invoice_id: null,
    })
    setAddCreditSaving(false)
    if (err) { setError('Failed to add credit: ' + err.message); return }
    setAddCreditModal(false)
    setAddCreditForm({ studentId: '', amount: '', reason: '' })
    setAddCreditSearch(''); setAddCreditReasonType(''); setAddCreditOtherReason('')
    setAddCreditSelectedLesson(null); setAddCreditLessons([])
    // Refresh credits list
    supabase.from('student_credits')
      .select('id, student_id, amount, reason, notes, created_at, students(full_name, year, school, family_id)')
      .is('invoice_id', null).order('created_at', { ascending: false })
      .then(({ data }) => setHeldCredits(data || []))
  }

  // ── Referral handler ──────────────────────────────────────────────────────
  const handleLogReferral = async ({ referringStudentId, referredStudentId }) => {
    const { error: refErr } = await supabase.from('referrals').insert({
      referring_student_id: referringStudentId, referred_student_id: referredStudentId,
    })
    if (refErr) { setError('Failed to log referral: ' + refErr.message); return }

    // Apply $50 to an invoice as its own credit line and recompute the total.
    const applyToInvoice = async (inv, label) => {
      const newLineItems = [...(inv.line_items || []), { type: 'credit', reason: label, amount: -50 }]
      const newTotal = Math.max(0, newLineItems.reduce((s, l) => s + (Number(l.amount) || 0), 0))
      await supabase.from('invoices').update({ line_items: newLineItems, subtotal: newTotal, total: newTotal }).eq('id', inv.id)
    }

    // Referred family: $50 off their current (unpaid, non-voided) invoice now.
    const { data: referredInv } = await supabase.from('invoices')
      .select('id, total, line_items').eq('student_id', referredStudentId)
      .not('status', 'in', '(paid,voided)')
      .order('id', { ascending: false }).limit(1).maybeSingle()
    await supabase.from('student_credits').insert({
      student_id: referredStudentId, amount: 50, reason: 'referral_referred',
      notes: 'Referral discount — welcome credit', invoice_id: referredInv?.id ?? null,
    })
    if (referredInv) await applyToInvoice(referredInv, 'Referral discount — welcome credit')

    // Referring family: if their current invoice is still a draft, apply the
    // $50 to it now; otherwise hold the credit for their next invoice.
    const referredFirst = (allStudents.find(s => s.id === referredStudentId)?.full_name || '').split(' ')[0]
    const rewardLabel = referredFirst ? `Referral reward — thanks for referring ${referredFirst}!` : 'Referral reward — thank you!'
    const { data: referringInv } = await supabase.from('invoices')
      .select('id, total, line_items').eq('student_id', referringStudentId)
      .eq('status', 'draft')
      .order('id', { ascending: false }).limit(1).maybeSingle()
    await supabase.from('student_credits').insert({
      student_id: referringStudentId, amount: 50, reason: 'referral_referring',
      notes: rewardLabel,
      invoice_id: referringInv?.id ?? null,
    })
    if (referringInv) await applyToInvoice(referringInv, rewardLabel)

    setReferralModal(false)
    setSuccessMsg(`Referral logged. $50 applied to referred family; $50 ${referringInv ? 'applied to referring family\'s draft invoice' : 'pending for referring family\'s next invoice'}.`)
    await loadInvoices()
  }

  // ── Status change handler ─────────────────────────────────────────────────
  const handleStatusChange = async (invoiceId, field, value) => {
    setStatusEditing(invoiceId)
    try {
      const res = await authedFetch('/api/update-invoice-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, field, value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, [field]: value } : i))

      // Auto-send payment confirmation when marked paid
      if (field === 'payment_status' && value === 'paid') {
        try {
          const cfRes = await authedFetch('/api/send-payment-confirmation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_id: invoiceId }),
          })
          const cfData = await cfRes.json()
          if (cfRes.ok) {
            setSuccessMsg(`Payment confirmation sent to ${cfData.sent_to}`)
          } else {
            // Non-fatal — invoice is marked paid, email just failed
            setError(`Invoice marked paid but confirmation email failed: ${cfData.error}`)
          }
        } catch (emailErr) {
          setError(`Invoice marked paid but confirmation email failed: ${emailErr.message}`)
        }
      }
    } catch (e) { setError('Status update failed: ' + e.message) }
    setStatusEditing(null)
  }

  // ── Resend payment confirmation ───────────────────────────────────────────
  const [resendingId, setResendingId] = useState(null)
  const handleResendConfirmation = async (invoiceId) => {
    setResendingId(invoiceId)
    try {
      const res = await authedFetch('/api/send-payment-confirmation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccessMsg(`Payment confirmation resent to ${data.sent_to}`)
    } catch (e) { setError('Resend failed: ' + e.message) }
    setResendingId(null)
  }

  const handleGenerate = async () => {
    setGenerating(true); setError(null); setSuccessMsg(null)
    try {
      const res  = await authedFetch('/api/generate-draft-invoices', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ term_id: termId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const errMsg = data.errors?.length ? ` Errors: ${data.errors.map(e => `${e.key}: ${e.error}`).join('; ')}` : ''
      setSuccessMsg(`Created ${data.created} draft invoice${data.created !== 1 ? 's' : ''}. ${data.skipped ? `${data.skipped} already existed.` : ''}${errMsg}`)
      if (errMsg) setError(errMsg)
      await loadInvoices()
    } catch (e) { setError(e.message) } finally { setGenerating(false) }
  }

  const [refreshingId, setRefreshingId] = useState(null)

  const handleRefresh = async (inv) => {
    setRefreshingId(inv.id)
    try {
      const res  = await authedFetch('/api/refresh-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === inv.id
        ? { ...i, line_items: data.line_items, subtotal: data.total, total: data.total }
        : i
      ))
      if (data.updated === 0) setSuccessMsg('Prices already up to date.')
      else setSuccessMsg(`Refreshed ${data.updated} line item${data.updated !== 1 ? 's' : ''} with latest prices.`)
    } catch (e) { setError(e.message) }
    finally { setRefreshingId(null) }
  }

  const handleApprove = async (inv) => {
    setApprovingId(inv.id)
    try {
      const res = await authedFetch('/api/approve-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'approved' } : i))
    } catch (e) { setError(e.message) } finally { setApprovingId(null) }
  }

  const handleRegenerateAllPdfs = async () => {
    const targets = invoices.filter(i => i.status !== 'voided')
    setRegenAll(true)
    setRegenProgress({ done: 0, total: targets.length })
    const termDates = term ? `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}` : ''
    for (let idx = 0; idx < targets.length; idx++) {
      const inv = targets[idx]
      try {
        const doc = await generateInvoicePdf(inv, term?.name || '', termDates)
        const pdfBlob = doc.output('blob')
        const filename = `${inv.invoice_number || 'invoice'}.pdf`
        const path = `invoices/${termId}/${filename}`
        const { error: upErr } = await supabase.storage
          .from('invoices')
          .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })
        if (!upErr) {
          await supabase.from('invoices').update({ pdf_path: path }).eq('id', inv.id)
          setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, pdf_path: path } : i))
        }
      } catch (e) { /* skip failed invoice, continue */ }
      setRegenProgress({ done: idx + 1, total: targets.length })
    }
    setRegenAll(false)
    setSuccessMsg(`Regenerated ${targets.length} invoice PDFs.`)
  }

  const handleGeneratePdf = async (inv) => {
    setPdfGenId(inv.id)
    try {
      const termDates = term
        ? `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}`
        : ''
      const doc = await generateInvoicePdf(inv, term?.name || '', termDates)

      // Download PDF
      const filename = `${inv.invoice_number || 'invoice'}.pdf`
      doc.save(filename)

      // Upload to Supabase Storage
      const pdfBlob = doc.output('blob')
      const path    = `invoices/${termId}/${filename}`
      const { error: upErr } = await supabase.storage
        .from('invoices')
        .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })

      if (!upErr) {
        await supabase.from('invoices').update({ pdf_path: path }).eq('id', inv.id)
        setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, pdf_path: path } : i))
      }
    } catch (e) { setError(e.message) } finally { setPdfGenId(null) }
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = {
    total:    invoices.length,
    draft:    invoices.filter(i => i.status === 'draft').length,
    approved: invoices.filter(i => ['approved', 'synced_to_xero'].includes(i.status)).length,
    paid:     invoices.filter(i => i.payment_status === 'paid').length,
    overdue:  invoices.filter(i => i.payment_status === 'overdue').length,
    revenue:  invoices.filter(i => i.status !== 'voided' && i.status !== 'draft').reduce((s, i) => s + (Number(i.total) || 0), 0),
    warnings: invoices.filter(i => getWarnings(i, i.prev_unpaid).length > 0).length,
  }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-6xl mx-auto px-6 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/tutor/payroll" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Accounting</Link>
        </div>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Invoices</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Generate, approve, and manage term invoices.</p>
          </div>
          {mainTab === 'invoices' && (
          <div className="flex items-center gap-2">
            {termId && (
              <button
                onClick={handleRegenerateAllPdfs}
                disabled={regenAll}
                className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-2 rounded-full transition disabled:opacity-50"
              >
                {regenAll
                  ? `↻ Regenerating… (${regenProgress.done}/${regenProgress.total})`
                  : '↻ Regenerate All PDFs'}
              </button>
            )}
            <button
              onClick={() => setReferralModal(true)}
              className="text-xs font-semibold text-[#7C3AED] border border-[#EDE9FE] bg-white hover:bg-[#F5F3FF] px-4 py-2 rounded-full transition"
            >
              🤝 Log Referral
            </button>
            <select
              value={termId}
              onChange={e => { setTermId(e.target.value); setInvoices([]) }}
              className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/25"
            >
              <option value="">Select term…</option>
              {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          )}
        </div>

        {/* Main tabs */}
        <div className="flex items-center gap-1 bg-white border border-[#DEE7FF] rounded-xl p-1 mb-6 w-fit">
          {[{ id: 'invoices', label: 'Invoices' }, { id: 'credits', label: '💳 Credit Balances' }, { id: 'template', label: '✉ Email Template' }].map(t => (
            <button key={t.id} onClick={() => setMainTab(t.id)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${mainTab === t.id ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#325099]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {mainTab === 'invoices' && <>
        {error   && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>}
        {successMsg && <div className="bg-[#D1FAE5] border border-[#34D399] text-[#065F46] text-sm rounded-xl px-4 py-3 mb-5">{successMsg}</div>}

        {/* Xero connection banner */}
        <XeroBanner
          xeroConnected={xeroConnected}
          xeroResult={xeroResult}
          xeroSyncing={xeroSyncing}
          termId={termId}
          onSync={handleSyncToXero}
        />

        {termId && (
          <>
            {/* Stats / filter tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              {[
                { id: 'all',      label: 'Total',    value: stats.total,    cls: 'text-[#062E63]' },
                { id: 'draft',    label: 'Draft',    value: stats.draft,    cls: 'text-[#325099]' },
                { id: 'approved', label: 'Approved', value: stats.approved, cls: 'text-[#5B21B6]' },
                { id: 'paid',     label: 'Paid',     value: stats.paid,     cls: 'text-[#065F46]' },
                { id: 'overdue',  label: 'Overdue',  value: stats.overdue,  cls: stats.overdue > 0 ? 'text-red-600' : 'text-[#325099]' },
                { id: 'warnings', label: 'Warnings', value: stats.warnings, cls: stats.warnings > 0 ? 'text-[#92400E]' : 'text-[#325099]' },
                { id: 'revenue',  label: 'Revenue',  value: `$${stats.revenue.toLocaleString('en-AU', { minimumFractionDigits: 0 })}`, cls: 'text-[#062E63]', noFilter: true },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => !s.noFilter && setFilterTab(f => f === s.id ? 'all' : s.id)}
                  className={`bg-white border rounded-xl px-3 py-3 text-center transition ${
                    !s.noFilter ? 'hover:border-[#325099]/40 cursor-pointer' : 'cursor-default'
                  } ${filterTab === s.id ? 'border-[#325099] ring-2 ring-[#325099]/20' : 'border-[#DEE7FF]'}`}
                >
                  <div className={`text-lg font-bold ${s.cls}`}>{s.value}</div>
                  <div className="text-[10px] text-[#325099]/60 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</div>
                </button>
              ))}
            </div>

            {/* Generate button */}
            {invoices.length === 0 && !loading && (
              <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center mb-6">
                <p className="text-4xl mb-4">📄</p>
                <p className="text-sm font-semibold text-[#062E63] mb-1">No invoices for {term?.name}</p>
                <p className="text-xs text-[#325099]/60 mb-6">Generate draft invoices from active enrolments to get started.</p>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-[#062E63] text-white text-sm font-semibold px-8 py-3 rounded-full hover:bg-[#325099] transition disabled:opacity-40"
                >
                  {generating ? 'Generating…' : '⚡ Generate draft invoices'}
                </button>
              </div>
            )}

            {invoices.length > 0 && (() => {
              const filteredInvoices = filterTab === 'all'      ? invoices
                : filterTab === 'draft'    ? invoices.filter(i => i.status === 'draft')
                : filterTab === 'approved' ? invoices.filter(i => ['approved', 'synced_to_xero'].includes(i.status))
                : filterTab === 'paid'     ? invoices.filter(i => i.payment_status === 'paid')
                : filterTab === 'overdue'  ? invoices.filter(i => i.payment_status === 'overdue')
                : filterTab === 'warnings' ? invoices.filter(i => getWarnings(i, i.prev_unpaid).length > 0)
                : invoices
              return <>
            {/* eslint-disable-next-line no-unused-vars */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#325099]/60">
                    {filteredInvoices.length}{filteredInvoices.length !== invoices.length ? ` of ${invoices.length}` : ''} invoice{invoices.length !== 1 ? 's' : ''}
                    {filterTab !== 'all' && <span className="ml-1.5 text-xs font-semibold text-[#325099] bg-[#EEF4FF] px-2 py-0.5 rounded-full capitalize">{filterTab}</span>}
                  </span>
                  {filterTab !== 'all' && (
                    <button onClick={() => setFilterTab('all')} className="text-[10px] text-[#325099]/50 hover:text-[#325099] transition">✕ Clear filter</button>
                  )}
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:bg-[#F0F4FF] transition disabled:opacity-40"
                >
                  {generating ? 'Generating…' : '+ Generate new drafts'}
                </button>
              </div>

            {/* Invoice table */}
            {loading ? (
              <div className="text-center py-16 text-[#325099]/40 text-sm">Loading invoices…</div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-12 text-[#325099]/40 text-sm">No invoices match this filter.</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                {filteredInvoices.map(inv => {
                  const warnings    = getWarnings(inv, inv.prev_unpaid)
                  const statusStyle = STATUS_LABELS[inv.status] || STATUS_LABELS.draft
                  const isApproving = approvingId === inv.id
                  const isGenPdf    = pdfGenId    === inv.id
                  // All amounts are inc-GST. GST is a component of the total (total ÷ 11).
                  const total    = parseFloat(inv.total) || 0
                  const gst      = inv.is_legacy ? 0 : total / 11
                  const subtotal = total  // displayed in totals row
                  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
                  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
                  const creditLines   = sortCreditLines((inv.line_items || []).filter(l => l.type === 'credit'))

                  return (
                    <div key={inv.id} className={`bg-white rounded-2xl border overflow-hidden transition ${warnings.length ? 'border-[#FDE047]' : 'border-[#DEE7FF]'}`}>
                      {/* Invoice header */}
                      <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-[#DEE7FF]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#062E63]">{inv.invoice_number || `#${inv.id}`}</span>
                            {/* Stage badge */}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(STAGE_LABELS[inv.status] || STAGE_LABELS.draft).cls}`}>
                              {(STAGE_LABELS[inv.status] || STAGE_LABELS.draft).label}
                            </span>
                            {/* Delivery badge */}
                            {inv.delivery_status && (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DELIVERY_LABELS[inv.delivery_status]?.cls || 'bg-[#F3F4F6] text-gray-500'}`}>
                                {DELIVERY_LABELS[inv.delivery_status]?.label || inv.delivery_status}
                              </span>
                            )}
                            {/* Payment badge */}
                            {inv.payment_status && (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PAYMENT_LABELS[inv.payment_status]?.cls || 'bg-[#F3F4F6] text-gray-500'}`}>
                                {PAYMENT_LABELS[inv.payment_status]?.label || inv.payment_status}
                              </span>
                            )}
                            {inv.is_legacy && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-gray-500">Legacy</span>}
                            {inv.xero_invoice_id
                              ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#065F46]">✓ Xero</span>
                              : xeroConnected && inv.status !== 'draft' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-gray-400">Not synced</span>
                            }
                            {warnings.map(w => <Warning key={w} text={w} />)}
                          </div>
                          <p className="text-sm font-semibold text-[#2A2035] mt-0.5">{inv.parent_name}</p>
                          <p className="text-xs text-[#325099]/50">{inv.parent_email || 'no email'}</p>
                          {inv.student_names?.length > 0 && (
                            <p className="text-xs text-[#325099]/70 mt-0.5">{inv.student_names.join(', ')}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right space-y-1.5">
                          <p className="text-lg font-bold text-[#062E63]">{fmtMoney(total)}</p>
                          <p className="text-[10px] text-[#325099]/50">inc GST · due {fmtDate(inv.due_date)}</p>
                          {/* Payment method — inherited from the family (set per student
                              in the database). Read-only here to keep one source of truth. */}
                          <div className="flex items-center justify-end">
                            <span title="Set on the student in the database — a family invoice is cash if any member is cash"
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                (inv.payment_method || 'bank') === 'cash'
                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                  : 'bg-[#EEF4FF] border-[#325099]/30 text-[#325099]'
                              }`}>
                              {(inv.payment_method || 'bank') === 'cash' ? '💵 Cash' : '🏦 Bank'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Line items */}
                      <div className="px-5 py-3">
                        <table className="w-full text-xs">
                          <tbody>
                            {enrolLines.map((l, i) => (
                              <tr key={i} className="border-b border-[#F0F4FF] last:border-0">
                                <td className="py-1.5 font-medium text-[#062E63]">{l.student_name}</td>
                                <td className="py-1.5 text-[#325099]/70">
                                  {l.class_name}
                                  {l.day && <span className="text-[#325099]/40 ml-1">· {l.day}{l.start_time ? ` ${l.start_time}` : ''}</span>}
                                </td>
                                <td className="py-1.5 text-right text-[#325099]">{fmtMoney(l.amount)}</td>
                              </tr>
                            ))}
                            {discountLines.map((l, i) => (
                              <tr key={`d${i}`} className="border-b border-[#F0F4FF] last:border-0">
                                <td className="py-1.5 text-[#7C3AED] italic" colSpan={2}>{l.reason}</td>
                                <td className="py-1.5 text-right text-[#7C3AED]">({fmtMoney(Math.abs(l.amount))})</td>
                              </tr>
                            ))}
                            {creditLines.map((l, i) => (
                              <tr key={`c${i}`} className="border-b border-[#F0F4FF] last:border-0">
                                <td className="py-1.5 text-[#065F46] italic" colSpan={2}>Credit: {(l.reason || '').replace(/^credit\s*[-–:]\s*/i, '')}</td>
                                <td className="py-1.5 text-right text-[#065F46]">({fmtMoney(Math.abs(l.amount))})</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Totals row */}
                        <div className="mt-2 pt-2 border-t border-[#DEE7FF] flex justify-end gap-6 text-xs text-[#325099]/70">
                          {!inv.is_legacy && <span>GST included <strong className="text-[#2A2035]">{fmtMoney(gst)}</strong></span>}
                          <span className="font-bold text-[#062E63]">Total {fmtMoney(total)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="px-5 py-3 bg-[#F8FAFF] border-t border-[#DEE7FF] flex items-center gap-2 flex-wrap">
                        {inv.status === 'draft' && (
                          <>
                            <button onClick={() => handleRefresh(inv)} disabled={refreshingId === inv.id}
                              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-1.5 rounded-full transition disabled:opacity-40">
                              {refreshingId === inv.id ? 'Refreshing…' : '↻ Refresh'}
                            </button>
                            <button onClick={() => handleApprove(inv)} disabled={isApproving || warnings.length > 0}
                              title={warnings.length > 0 ? `Resolve ${warnings.length} warning${warnings.length > 1 ? 's' : ''} before approving` : ''}
                              className="text-xs font-semibold bg-[#062E63] text-white px-4 py-1.5 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
                              {isApproving ? 'Approving…' : '✓ Approve'}
                            </button>
                          </>
                        )}
                        {['approved', 'synced_to_xero'].includes(inv.status) && (
                          <button onClick={() => handleGeneratePdf(inv)} disabled={isGenPdf}
                            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-1.5 rounded-full transition disabled:opacity-40">
                            {isGenPdf ? 'Generating…' : inv.pdf_path ? '↻ PDF' : '📄 Generate PDF'}
                          </button>
                        )}
                        {inv.pdf_path && (
                          <a href={supabase.storage.from('invoices').getPublicUrl(inv.pdf_path).data.publicUrl}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-1.5 rounded-full transition">
                            ↗ View PDF
                          </a>
                        )}
                        {/* Add Credit */}
                        {inv.status !== 'voided' && inv.status !== 'draft' && (() => {
                          const members = [...new Map(
                            (inv.line_items || []).filter(l => l.type === 'enrolment')
                              .map(l => [l.student_id, { id: l.student_id, full_name: l.student_name }])
                          ).values()]
                          return (
                            <button onClick={() => setCreditModal({ invoiceId: inv.id, members })}
                              className="text-xs font-semibold text-[#065F46] border border-[#A7F3D0] bg-white hover:bg-[#F0FDF4] px-4 py-1.5 rounded-full transition">
                              + Credit
                            </button>
                          )
                        })()}
                        {/* Top-up (only on paid invoices) */}
                        {inv.payment_status === 'paid' && (
                          <button onClick={() => setTopUpModal(inv)}
                            className="text-xs font-semibold text-[#7C3AED] border border-[#EDE9FE] bg-white hover:bg-[#F5F3FF] px-4 py-1.5 rounded-full transition">
                            + Top-up
                          </button>
                        )}
                        {/* Three status dropdowns */}
                        <div className="ml-auto flex gap-1.5">
                          <select
                            value={inv.status}
                            disabled={statusEditing === inv.id}
                            onChange={e => handleStatusChange(inv.id, 'status', e.target.value)}
                            className={`text-[11px] font-semibold border rounded-full px-2.5 py-1 focus:outline-none disabled:opacity-40 transition-colors ${STAGE_SELECT_CLS[inv.status] || STAGE_SELECT_CLS.draft}`}
                          >
                            <option value="draft">Draft</option>
                            <option value="approved">Approved</option>
                            <option value="synced_to_xero">In Xero</option>
                            <option value="voided">Voided</option>
                          </select>
                          {inv.delivery_status === 'sent' ? (
                            confirmUnsentId === inv.id ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-[#325099]/60">Mark unsent?</span>
                                <button
                                  onClick={() => { handleStatusChange(inv.id, 'delivery_status', 'unsent'); setConfirmUnsentId(null) }}
                                  className="text-[11px] font-semibold bg-red-500 text-white px-2.5 py-1 rounded-full hover:bg-red-600 transition"
                                >Yes</button>
                                <button
                                  onClick={() => setConfirmUnsentId(null)}
                                  className="text-[11px] text-[#325099]/50 hover:text-[#325099] px-1.5 py-1"
                                >Cancel</button>
                              </div>
                            ) : (
                              <span
                                title="Click to mark as unsent"
                                onClick={() => setConfirmUnsentId(inv.id)}
                                className="cursor-pointer text-[11px] font-semibold border rounded-full px-2.5 py-1 transition-colors bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7] hover:opacity-70"
                              >
                                ✉ Sent
                              </span>
                            )
                          ) : (
                            <button
                              onClick={() => setSendModalInv(inv)}
                              disabled={statusEditing === inv.id || !inv.parent_email || inv.status === 'draft' || inv.status === 'voided'}
                              title={inv.status === 'draft' ? 'Approve invoice before sending' : inv.status === 'voided' ? 'Invoice is voided' : !inv.parent_email ? 'No email on file' : 'Send invoice by email'}
                              className="text-[11px] font-semibold border rounded-full px-2.5 py-1 transition-colors bg-[#F0F4FF] text-[#325099] border-[#C7D5F8] hover:bg-[#DEE7FF] disabled:opacity-40"
                            >
                              ✉ Send
                            </button>
                          )}
                          <select
                            value={inv.payment_status || ''}
                            disabled={statusEditing === inv.id}
                            onChange={e => {
                              const val = e.target.value || null
                              if (val === 'paid') { setConfirmPaidInv(inv); return }
                              handleStatusChange(inv.id, 'payment_status', val)
                            }}
                            className={`text-[11px] font-semibold border rounded-full px-2.5 py-1 focus:outline-none disabled:opacity-40 transition-colors ${PAYMENT_SELECT_CLS[inv.payment_status || ''] || PAYMENT_SELECT_CLS['']}`}
                          >
                            <option value="">— Payment</option>
                            <option value="unpaid">Unpaid</option>
                            <option value="paid">Paid</option>
                            <option value="overdue">Overdue</option>
                          </select>
                          {inv.payment_status === 'overdue' && (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setReminderModalInv(inv)}
                                disabled={!inv.parent_email || inv.status === 'draft' || inv.status === 'voided'}
                                title={!inv.parent_email ? 'No email on file' : inv.status === 'draft' ? 'Approve invoice first' : 'Send an overdue-payment reminder'}
                                className="text-[11px] font-semibold border rounded-full px-2.5 py-1 transition-colors bg-[#FEF3C7] text-[#92400E] border-[#FCD34D] hover:bg-[#FDE68A] disabled:opacity-40"
                              >
                                ⏰ {inv.reminder_sent_at ? 'Remind again' : 'Send reminder'}
                              </button>
                              {inv.reminder_sent_at && (
                                <span className="text-[10px] text-[#92400E]/70" title="Last overdue reminder sent">
                                  Reminded {fmtDate(inv.reminder_sent_at)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            </>
          })()}
          </>
        )}

        {!termId && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-16 text-center text-[#325099]/40 text-sm">
            Select a term to view invoices.
          </div>
        )}
        </>}

        {/* Credit balances tab */}
        {mainTab === 'credits' && (
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#062E63]">Held credit balances</h2>
                <p className="text-xs text-[#325099]/60 mt-0.5">Credits awaiting application to the next invoice. These are applied automatically when the next term's invoices are generated.</p>
              </div>
              <button onClick={() => { setAddCreditModal(true); setAddCreditForm({ studentId: '', amount: '', reason: '' }); setAddCreditSearch('') }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition">
                + Add Credit Balance
              </button>
            </div>

            {creditsLoading ? (
              <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /></div>
            ) : heldCredits.length === 0 ? (
              <div className="bg-white border border-[#DEE7FF] rounded-2xl p-12 text-center text-[#325099]/40 text-sm">No pending credits.</div>
            ) : (() => {
              const byStudent = {}
              for (const c of heldCredits) {
                if (!byStudent[c.student_id]) byStudent[c.student_id] = { student: c.students, credits: [] }
                byStudent[c.student_id].credits.push(c)
              }
              return (
                <div className="space-y-3">
                  {Object.entries(byStudent).map(([sid, { student, credits }]) => {
                    const total = credits.reduce((s, c) => s + Number(c.amount), 0)
                    return (
                      <div key={sid} className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
                        <div className="px-5 py-3 flex items-center justify-between border-b border-[#DEE7FF]">
                          <div>
                            <p className="font-semibold text-sm text-[#062E63]">{student?.full_name || '—'}</p>
                            <p className="text-[11px] text-[#325099]/50">Year {student?.year || '?'} · {student?.school || '—'}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-emerald-700">${total.toFixed(2)}</p>
                            <p className="text-[10px] text-[#325099]/40">{credits.length} credit{credits.length > 1 ? 's' : ''} held</p>
                          </div>
                        </div>
                        <div className="divide-y divide-[#F0F4FF]">
                          {credits.map(c => (
                            <div key={c.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-[#325099]/80 truncate">{c.reason}</p>
                                {c.notes && <p className="text-[11px] text-[#325099]/50 truncate">{c.notes}</p>}
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="text-xs font-semibold text-emerald-700">${Number(c.amount).toFixed(2)}</span>
                                <span className="text-[10px] text-[#325099]/40">{new Date(c.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                                <button
                                  onClick={async () => {
                                    if (!confirm('Delete this credit?')) return
                                    await supabase.from('student_credits').delete().eq('id', c.id)
                                    setHeldCredits(prev => prev.filter(x => x.id !== c.id))
                                  }}
                                  className="text-red-400 hover:text-red-600 transition text-xs leading-none"
                                  title="Delete credit"
                                >✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* Add Credit Balance modal */}
        {addCreditModal && (() => {
          const canSave = addCreditForm.studentId && addCreditForm.amount &&
            (addCreditReasonType === 'absence' ? !!addCreditForm.reason : !!addCreditOtherReason.trim())
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#062E63]">Add Credit Balance</h2>
                  <button onClick={() => setAddCreditModal(false)} className="text-[#325099]/50 hover:text-[#325099] text-lg leading-none">✕</button>
                </div>

                {/* Student picker */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#325099]">Student</label>
                  <input
                    type="text" placeholder="Search student…" value={addCreditSearch}
                    onChange={e => {
                      setAddCreditSearch(e.target.value)
                      setAddCreditForm(f => ({ ...f, studentId: '', reason: '' }))
                      setAddCreditReasonType(''); setAddCreditSelectedLesson(null)
                    }}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] placeholder:text-[#325099]/40 focus:outline-none focus:ring-2 focus:ring-[#325099]/30"
                  />
                  {addCreditSearch && !addCreditForm.studentId && (
                    <div className="border border-[#DEE7FF] rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                      {allStudents.filter(s => s.full_name.toLowerCase().includes(addCreditSearch.toLowerCase())).slice(0, 8).map(s => (
                        <button key={s.id} onClick={() => { setAddCreditForm(f => ({ ...f, studentId: s.id, reason: '' })); setAddCreditSearch(s.full_name); setAddCreditReasonType(''); setAddCreditSelectedLesson(null) }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-[#EEF4FF] text-[#062E63] border-b border-[#F0F4FF] last:border-0">
                          {s.full_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reason type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#325099]">Reason</label>
                  <select
                    value={addCreditReasonType}
                    onChange={e => { setAddCreditReasonType(e.target.value); setAddCreditForm(f => ({ ...f, reason: '', amount: '' })); setAddCreditSelectedLesson(null); setAddCreditOtherReason('') }}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:ring-2 focus:ring-[#325099]/30 bg-white"
                  >
                    <option value="">Select…</option>
                    <option value="absence">Absence</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Absence: lesson picker */}
                {addCreditReasonType === 'absence' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#325099]">Lesson</label>
                    {addCreditLessonsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-[#325099]/50 py-2"><div className="w-3.5 h-3.5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /> Loading lessons…</div>
                    ) : (
                      <select
                        value={addCreditSelectedLesson?.id || ''}
                        onChange={e => {
                          const lesson = addCreditLessons.find(l => String(l.id) === e.target.value)
                          setAddCreditSelectedLesson(lesson || null)
                          if (lesson) {
                            const d = new Date(lesson.lesson_date + 'T00:00:00')
                            const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]
                            const dateStr = `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`
                            setAddCreditForm(f => ({
                              ...f,
                              reason: `Absence for ${lesson.classes?.class_name || 'class'} on ${dayName} ${dateStr}`,
                              amount: lesson.perLesson != null ? String(lesson.perLesson) : f.amount,
                            }))
                          }
                        }}
                        className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:ring-2 focus:ring-[#325099]/30 bg-white"
                      >
                        <option value="">Select lesson…</option>
                        {addCreditLessons.map(l => {
                          const d = new Date(l.lesson_date + 'T00:00:00')
                          const label = `${l.classes?.class_name} – ${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`
                          return <option key={l.id} value={l.id}>{label}</option>
                        })}
                      </select>
                    )}
                    {addCreditForm.reason ? (
                      <p className="text-[11px] text-[#325099]/60 bg-[#F8FAFF] border border-[#DEE7FF] rounded px-2 py-1 break-words">{addCreditForm.reason}</p>
                    ) : null}
                  </div>
                )}

                {/* Other: free text */}
                {addCreditReasonType === 'other' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#325099]">Description</label>
                    <input
                      type="text" placeholder="e.g. Referral reward, goodwill credit…"
                      value={addCreditOtherReason}
                      onChange={e => setAddCreditOtherReason(e.target.value)}
                      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] placeholder:text-[#325099]/40 focus:outline-none focus:ring-2 focus:ring-[#325099]/30"
                    />
                  </div>
                )}

                {/* Amount */}
                {addCreditReasonType && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#325099]">Amount ($)</label>
                    <input
                      type="number" min="0" step="0.01" placeholder="e.g. 50"
                      value={addCreditForm.amount}
                      onChange={e => setAddCreditForm(f => ({ ...f, amount: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] placeholder:text-[#325099]/40 focus:outline-none focus:ring-2 focus:ring-[#325099]/30"
                    />
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={() => setAddCreditModal(false)}
                    className="flex-1 px-4 py-2 border border-[#DEE7FF] text-xs font-semibold text-[#325099] rounded-lg hover:bg-[#F0F4FF] transition">
                    Cancel
                  </button>
                  <button onClick={handleSaveManualCredit} disabled={addCreditSaving || !canSave}
                    className="flex-1 px-4 py-2 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition disabled:opacity-40 disabled:cursor-not-allowed">
                    {addCreditSaving ? 'Saving…' : 'Add Credit'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Email template tab */}
        {mainTab === 'template' && (
          <div className="bg-white border border-[#DEE7FF] rounded-2xl p-6 max-w-3xl space-y-5">
            <div>
              <h2 className="text-sm font-bold text-[#062E63] mb-4">Invoice email template</h2>
              <div className="bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-3 mb-4">
                <p className="text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-2">
                  Available placeholders · use <code className="font-mono">**text**</code> for bold
                </p>
                <div className="flex flex-wrap gap-3">
                  {[
                    { tag: '{{guardian}}',     desc: "Guardian's first name" },
                    { tag: '{{studentNames}}', desc: 'Student name(s)' },
                    { tag: '{{term}}',         desc: 'Term name' },
                    { tag: '{{invNo}}',        desc: 'Invoice number' },
                    { tag: '{{amount}}',       desc: 'Amount due' },
                    { tag: '{{dueDate}}',      desc: 'Due date' },
                  ].map(p => (
                    <div key={p.tag} className="flex items-center gap-1.5">
                      <code className="text-[11px] font-mono bg-white border border-[#DEE7FF] rounded px-1.5 py-0.5 text-[#325099]">{p.tag}</code>
                      <span className="text-[11px] text-[#325099]/50">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Subject line</label>
                <input
                  value={emailSubjectTmpl}
                  onChange={e => setEmailSubjectTmpl(e.target.value)}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:border-[#325099]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Email body</label>
                <textarea
                  value={emailTemplate}
                  onChange={e => setEmailTemplate(e.target.value)}
                  rows={22}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#062E63] font-mono resize-y focus:outline-none focus:border-[#325099]"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={async () => {
                  setTmplSaving(true)
                  await supabase.from('portal_settings').upsert({ key: 'invoice_email_template', value: emailTemplate, updated_at: new Date().toISOString() })
                  await supabase.from('portal_settings').upsert({ key: 'invoice_email_subject',  value: emailSubjectTmpl,  updated_at: new Date().toISOString() })
                  setTmplSaving(false); setTmplSaved(true)
                  setTimeout(() => setTmplSaved(false), 3000)
                }}
                disabled={tmplSaving}
                className="text-xs font-semibold bg-[#062E63] text-white px-6 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40"
              >
                {tmplSaving ? 'Saving…' : 'Save changes'}
              </button>
              {tmplSaved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {creditModal && (
        <AddCreditModal
          members={creditModal.members}
          onClose={() => setCreditModal(null)}
          onSave={(fields) => handleAddCredit({ invoiceId: creditModal.invoiceId, ...fields })}
        />
      )}
      {referralModal && (
        <ReferralModal
          students={allStudents}
          onClose={() => setReferralModal(false)}
          onSave={handleLogReferral}
        />
      )}
      {topUpModal && (
        <TopUpInvoiceModal
          inv={topUpModal}
          allStudents={allStudents}
          onClose={() => setTopUpModal(null)}
          onCreated={() => { setTopUpModal(null); loadInvoices() }}
        />
      )}
      {sendModalInv && (
        <SendEmailModal
          inv={sendModalInv}
          term={term}
          emailTemplate={emailTemplate}
          emailSubjectTemplate={emailSubjectTmpl}
          onClose={() => setSendModalInv(null)}
          onSent={(id) => {
            setSendModalInv(null)
            setInvoices(prev => prev.map(i => i.id === id ? { ...i, delivery_status: 'sent' } : i))
          }}
        />
      )}
      {reminderModalInv && (
        <SendEmailModal
          inv={reminderModalInv}
          term={term}
          reminder
          onClose={() => setReminderModalInv(null)}
          onSent={(id, reminderSentAt) => {
            setReminderModalInv(null)
            setInvoices(prev => prev.map(i => i.id === id ? { ...i, reminder_sent_at: reminderSentAt || new Date().toISOString() } : i))
          }}
        />
      )}

      {/* ── Confirm mark as paid ─────────────────────────────────────────── */}
      {confirmPaidInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[#DEE7FF]">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-[#ECFDF5] text-xl">✅</span>
                <div>
                  <h3 className="font-bold text-[#062E63] text-sm">Mark as paid?</h3>
                  <p className="text-[11px] text-[#325099]/60 mt-0.5">{confirmPaidInv.invoice_number || 'Invoice'}</p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-[#2A2035]">
                You're marking this invoice as <strong>paid</strong> ({fmtMoney(confirmPaidInv.total)}).
              </p>
              {/* Email warning */}
              <div className="flex items-start gap-2.5 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3">
                <span className="text-base mt-0.5">📧</span>
                <div>
                  <p className="text-[11px] font-semibold text-[#92400E]">Payment confirmation email will be sent</p>
                  <p className="text-[11px] text-[#92400E]/80 mt-0.5">
                    {confirmPaidInv.parent_email
                      ? <>A receipt will be emailed to <strong>{confirmPaidInv.parent_email}</strong> automatically.</>
                      : 'No email address on file — confirmation will not be sent.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button
                onClick={() => setConfirmPaidInv(null)}
                className="text-sm font-semibold text-[#325099]/60 hover:text-[#325099] px-4 py-2 rounded-full border border-[#DEE7FF] hover:bg-[#F8FAFF] transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleStatusChange(confirmPaidInv.id, 'payment_status', 'paid')
                  setConfirmPaidInv(null)
                }}
                className="text-sm font-semibold text-white bg-[#065F46] hover:bg-[#047857] px-4 py-2 rounded-full transition"
              >
                Confirm payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
