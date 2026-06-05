'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms } from '../../../../lib/terms'

/*
 * Invoice Dashboard — /tutor/accounting/invoices
 * Phase 1: draft generation, warnings, approve, generate + download PDF
 */

const STATUS_LABELS = {
  draft:          { label: 'Draft',            cls: 'bg-[#F0F4FF] text-[#325099]' },
  approved:       { label: 'Approved',          cls: 'bg-[#EDE9FE] text-[#5B21B6]' },
  synced_to_xero: { label: 'In Xero',           cls: 'bg-[#ECFDF5] text-[#065F46]' },
  sent:           { label: 'Sent',              cls: 'bg-[#D1FAE5] text-[#065F46]' },
  awaiting_payment:{ label: 'Awaiting payment', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  paid:           { label: 'Paid',              cls: 'bg-[#D1FAE5] text-[#065F46] font-bold' },
  overdue:        { label: 'Overdue',           cls: 'bg-[#FEE2E2] text-red-700 font-bold' },
  voided:         { label: 'Voided',            cls: 'bg-[#F3F4F6] text-gray-500' },
  credited:       { label: 'Credited',          cls: 'bg-[#F0F4FF] text-[#325099]' },
  unpaid:         { label: 'Unpaid',            cls: 'bg-[#FEF3C7] text-[#92400E]' },
}

const fmtMoney = n => `$${(Number(n) || 0).toFixed(2)}`
const fmtDate  = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function Warning({ text }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE047] px-2 py-0.5 rounded-full">
      ⚠ {text}
    </span>
  )
}

function getWarnings(inv, prevUnpaid) {
  const w = []
  if (!inv.parent_email)                             w.push('missing email')
  if (!inv.invoice_number)                           w.push('no invoice number')
  if ((inv.total || 0) <= 0)                        w.push('zero/negative total')
  if (!inv.xero_contact_id)                         w.push('no Xero contact')
  if (inv.status !== 'voided' && prevUnpaid)         w.push('unpaid previous invoice')
  const missingFee  = (inv.line_items || []).filter(l => l.type === 'enrolment' && !l.unit_price)
  if (missingFee.length)                             w.push(`${missingFee.length} missing fee`)
  const missingTime = (inv.line_items || []).filter(l => l.type === 'enrolment' && !l.start_time)
  if (missingTime.length)                            w.push(`${missingTime.length} missing time`)
  const creditTotal = (inv.line_items || []).filter(l => l.type === 'credit').reduce((s, l) => s + Math.abs(l.amount || 0), 0)
  if (creditTotal > (inv.subtotal || 0) * 0.5 && creditTotal > 50) w.push('unusual credit')
  return w
}

// ── PDF generation (client-side jsPDF, no plugins) ───────────────────────────
async function generateInvoicePdf(inv, termName, termDates) {
  const { jsPDF } = await import('jspdf')

  const doc  = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W    = doc.internal.pageSize.getWidth()
  const H    = doc.internal.pageSize.getHeight()
  const navy = [6, 46, 99]
  const grey = [120, 130, 155]
  const light = [230, 235, 245]

  // ── Header bar ─────────────────────────────────────────────────────────
  doc.setFillColor(...navy)
  doc.rect(0, 0, W, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('CUBE', 14, 17)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.text('TUITION', 36, 17)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text('TAX INVOICE', W - 14, 17, { align: 'right' })

  // ── Invoice meta (top-right) ────────────────────────────────────────────
  let y = 35
  const metaLeft = W - 85
  const metaRight = W - 14

  const metaRow = (label, value, highlight = false) => {
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...grey)
    doc.text(label, metaLeft, y)
    doc.setFont('helvetica', highlight ? 'bold' : 'normal')
    if (highlight) doc.setTextColor(...navy); else doc.setTextColor(0, 0, 0)
    doc.text(value, metaRight, y, { align: 'right' })
    y += 6
  }

  metaRow('Invoice number:', inv.invoice_number || '—', true)
  metaRow('Invoice date:', fmtDate(inv.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)))
  metaRow('Due date:', fmtDate(inv.due_date))
  metaRow('Term:', termName || '—')

  // ── From / Bill To (left side) ──────────────────────────────────────────
  let ly = 35
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...grey)
  doc.text('FROM', 14, ly); ly += 5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0)
  doc.text('CUBE Tuition Pty Ltd', 14, ly); ly += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey)
  doc.text('admin@cubetuition.com.au', 14, ly); ly += 10

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...grey)
  doc.text('BILL TO', 14, ly); ly += 5
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0)
  doc.text(inv.parent_name || '—', 14, ly); ly += 5
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...grey)
  if (inv.parent_email) { doc.text(inv.parent_email, 14, ly); ly += 5 }
  if (inv.parent_phone) { doc.text(inv.parent_phone, 14, ly); ly += 5 }
  if (termDates) { doc.setFontSize(8); doc.text(`Term: ${termDates}`, 14, ly); ly += 5 }

  // ── Divider ─────────────────────────────────────────────────────────────
  const tableStartY = Math.max(y, ly) + 6
  doc.setDrawColor(...light)
  doc.line(14, tableStartY - 3, W - 14, tableStartY - 3)

  // ── Table header ────────────────────────────────────────────────────────
  const cols = { student: 14, description: 50, qty: 118, unitPrice: 134, amount: 166 }
  const rowH = 7

  doc.setFillColor(...navy)
  doc.rect(14, tableStartY, W - 28, rowH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(255, 255, 255)
  doc.text('Student',        cols.student + 2,   tableStartY + 4.5)
  doc.text('Class / Schedule', cols.description + 2, tableStartY + 4.5)
  doc.text('Qty',          cols.qty + 2,        tableStartY + 4.5, { align: 'center' })
  doc.text('Unit price',   cols.unitPrice + 16,  tableStartY + 4.5, { align: 'right' })
  doc.text('Amount',       W - 15,              tableStartY + 4.5, { align: 'right' })

  // ── Table rows ──────────────────────────────────────────────────────────
  const enrolLines = (inv.line_items || []).filter(l => l.type === 'enrolment')
  const creditLines = (inv.line_items || []).filter(l => l.type === 'credit')
  let ry = tableStartY + rowH

  const drawRow = (studentName, description, qty, unitPrice, amount, shade, isCredit = false) => {
    const lines = doc.splitTextToSize(description, 60)
    const cellH = Math.max(rowH, lines.length * 4.5 + 3)
    if (shade) { doc.setFillColor(248, 250, 255); doc.rect(14, ry, W - 28, cellH, 'F') }
    doc.setDrawColor(...light); doc.line(14, ry + cellH, W - 28 + 14, ry + cellH)
    doc.setFont('helvetica', isCredit ? 'italic' : 'normal')
    doc.setFontSize(8); doc.setTextColor(isCredit ? 5 : 0, isCredit ? 95 : 0, isCredit ? 70 : 0)
    doc.text(studentName, cols.student + 2, ry + 5)
    doc.text(lines, cols.description + 2, ry + 5)
    doc.text(qty, cols.qty + 2, ry + 5, { align: 'center' })
    doc.text(unitPrice, cols.unitPrice + 16, ry + 5, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(amount, W - 15, ry + 5, { align: 'right' })
    ry += cellH
  }

  enrolLines.forEach((l, i) => {
    const desc = [
      l.class_name,
      l.day ? `${l.day}${l.start_time ? ', ' + l.start_time : ''}` : '',
    ].filter(Boolean).join(' · ')
    drawRow(l.student_name, desc, '1', fmtMoney(l.unit_price), fmtMoney(l.amount), i % 2 === 1)
  })

  creditLines.forEach((l, i) => {
    drawRow('Credit', l.reason || 'Credit applied', '', '', `(${fmtMoney(Math.abs(l.amount))})`, (enrolLines.length + i) % 2 === 1, true)
  })

  // ── Totals ──────────────────────────────────────────────────────────────
  const totalIncGst = parseFloat(inv.total) || 0
  const gst         = totalIncGst / 11
  let ty2 = ry + 6
  const totalsL = W - 85

  doc.setFontSize(8.5)
  const addTotRow = (label, value, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setTextColor(...grey)
    doc.text(label, totalsL, ty2)
    doc.setTextColor(0, 0, 0)
    doc.text(value, W - 15, ty2, { align: 'right' })
    ty2 += 6
  }

  if (inv.sibling_discount > 0)      addTotRow('Sibling discount', `(${fmtMoney(inv.sibling_discount)})`)
  if (inv.multi_course_discount > 0) addTotRow('Multi-course discount', `(${fmtMoney(inv.multi_course_discount)})`)
  addTotRow('GST (included)', fmtMoney(gst))

  doc.setDrawColor(...light); doc.line(totalsL, ty2 - 3, W - 14, ty2 - 3)
  doc.setFillColor(...navy)
  doc.roundedRect(totalsL - 2, ty2 - 1, W - totalsL + 2 - 14 + 2, 11, 2, 2, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255)
  doc.text('TOTAL DUE (inc GST)', totalsL + 2, ty2 + 7)
  doc.text(fmtMoney(totalIncGst), W - 16, ty2 + 7, { align: 'right' })
  ty2 += 18

  // ── Payment instructions ────────────────────────────────────────────────
  if (ty2 > H - 40) { doc.addPage(); ty2 = 20 }
  doc.setDrawColor(...light); doc.line(14, ty2, W - 14, ty2); ty2 += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0)
  doc.text('Payment Instructions', 14, ty2); ty2 += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey)
  const instrText = (inv.payment_instructions || 'Please contact admin@cubetuition.com.au for payment details.')
    .replace('[Invoice Number]', inv.invoice_number || '')
  const instrLines = doc.splitTextToSize(instrText, W - 28)
  doc.text(instrLines, 14, ty2)

  // ── Footer on every page ────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7); doc.setTextColor(180, 185, 200)
    doc.text(
      `CUBE Tuition Pty Ltd  ·  ABN: XX XXX XXX XXX  ·  ${inv.invoice_number || ''}  ·  Page ${p} of ${pages}`,
      W / 2, H - 8, { align: 'center' }
    )
  }

  return doc
}

// ── Add Credit Modal ──────────────────────────────────────────────────────────
function AddCreditModal({ members, onClose, onSave }) {
  const [studentId, setStudentId] = useState(members?.[0]?.id ?? '')
  const [amount,    setAmount]    = useState('')
  const [reason,    setReason]    = useState('missed_lesson')
  const [notes,     setNotes]     = useState('')
  const [saving,    setSaving]    = useState(false)

  const REASONS = [
    { value: 'missed_lesson', label: 'Missed lesson' },
    { value: 'late_start',    label: 'Late start' },
    { value: 'other',         label: 'Other' },
  ]

  const handleSubmit = async () => {
    if (!studentId || !amount || Number(amount) <= 0) return
    setSaving(true)
    await onSave({ studentId, amount, reason, notes })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#2A2035] text-sm">Add Credit</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        {members.length > 1 && (
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)}
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Amount ($)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 50"
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Notes (optional)</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Missed Week 4 lesson"
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !amount || Number(amount) <= 0}
            className="px-5 py-2 bg-[#325099] text-white text-sm font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
            {saving ? 'Saving…' : 'Apply Credit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Log Referral Modal ────────────────────────────────────────────────────────
function ReferralModal({ students, onClose, onSave }) {
  const [referringId, setReferringId] = useState('')
  const [referredId,  setReferredId]  = useState('')
  const [saving,      setSaving]      = useState(false)

  const handleSubmit = async () => {
    if (!referringId || !referredId) return
    setSaving(true)
    await onSave({ referringStudentId: referringId, referredStudentId: referredId })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#2A2035] text-sm">Log Referral</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        <p className="text-xs text-[#2A2035]/60 -mt-2">Both families receive <strong>$50 off</strong>. The referred family gets it immediately; the referring family gets it on their next invoice.</p>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Referring student (existing family)</label>
          <select value={referringId} onChange={e => setReferringId(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Select student…</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Referred student (new family)</label>
          <select value={referredId} onChange={e => setReferredId(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Select student…</option>
            {students.filter(s => s.id !== referringId).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        {referringId && referredId && (
          <div className="rounded-xl bg-[#F0FDF4] border border-[#A7F3D0] px-4 py-3 text-xs text-[#065F46]">
            <p>✓ <strong>{students.find(s => s.id === referredId)?.full_name}</strong> — $50 applied to their current invoice</p>
            <p className="mt-1">✓ <strong>{students.find(s => s.id === referringId)?.full_name}</strong> — $50 pending for their next invoice</p>
          </div>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !referringId || !referredId || referringId === referredId}
            className="px-5 py-2 bg-[#7C3AED] text-white text-sm font-semibold rounded-lg hover:bg-[#6D28D9] transition disabled:opacity-40">
            {saving ? 'Logging…' : 'Log Referral'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Top-up Invoice Modal ──────────────────────────────────────────────────────
function TopUpInvoiceModal({ inv, allStudents, onClose, onCreated }) {
  const [enrolments, setEnrolments] = useState([])
  const [checked,    setChecked]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const memberIds = [...new Set((inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id))]
  const genCutoff = inv.created_at ? new Date(inv.created_at) : null

  useEffect(() => {
    if (!memberIds.length || !inv.term_id) { setLoading(false); return }
    ;(async () => {
      const { data: termClasses } = await supabase.from('classes').select('id, class_name').eq('term_id', inv.term_id)
      const termClassIds  = (termClasses || []).map(c => c.id)
      const classNameMap  = Object.fromEntries((termClasses || []).map(c => [c.id, c.class_name]))
      if (!termClassIds.length) { setLoading(false); return }

      const { data: enrRows } = await supabase.from('enrolments')
        .select('id, student_id, class_id, price, created_at')
        .in('student_id', memberIds).in('class_id', termClassIds)
        .order('created_at', { ascending: true })

      const rows = (enrRows || []).map(e => ({
        key:         `${e.student_id}__${e.class_id}`,
        enrolmentId: e.id,
        studentId:   e.student_id,
        studentName: allStudents.find(s => s.id === e.student_id)?.full_name ?? '—',
        classId:     e.class_id,
        className:   classNameMap[e.class_id] ?? '—',
        price:       Number(e.price ?? 0),
        createdAt:   e.created_at,
      }))

      setEnrolments(rows)
      setChecked(Object.fromEntries(rows.map(r => [r.key, !genCutoff || new Date(r.createdAt) > genCutoff])))
      setLoading(false)
    })()
  }, [])

  const checkedRows = enrolments.filter(e => checked[e.key])
  const subtotal    = checkedRows.reduce((s, e) => s + e.price, 0)
  const total       = Math.max(0, subtotal)

  const handleSubmit = async () => {
    if (!checkedRows.length) return
    setSaving(true); setError('')
    const { error: err } = await supabase.from('invoices').insert({
      term_id: inv.term_id, family_id: inv.family_id ?? null, student_id: inv.student_id ?? null,
      subtotal, sibling_discount: 0, multi_course_discount: 0, total,
      status: 'draft', is_topup: true,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF]">
          <h3 className="font-bold text-[#2A2035] text-sm">Top-up Invoice</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-xs text-[#2A2035]/60 mb-4">Select the new enrolments to include in a follow-up invoice. Enrolments added after the original invoice are pre-ticked.</p>
          {loading ? <p className="text-xs text-[#325099]/50 text-center py-6">Loading…</p> : enrolments.length === 0 ? (
            <p className="text-xs text-[#325099]/40 italic text-center py-6">No enrolments found for this family in this term.</p>
          ) : (
            <div className="space-y-2">
              {enrolments.map(e => (
                <label key={e.key} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#DEE7FF] hover:bg-[#F8FAFF] cursor-pointer">
                  <input type="checkbox" checked={checked[e.key] ?? false} onChange={ev => setChecked(p => ({ ...p, [e.key]: ev.target.checked }))} className="accent-[#325099] w-4 h-4" />
                  <div className="flex-1 text-xs">
                    <span className="font-semibold text-[#062E63]">{e.studentName}</span>
                    <span className="text-[#325099]/60 ml-2">{e.className}</span>
                  </div>
                  <span className="text-xs font-semibold text-[#325099]">{fmtMoney(e.price)}</span>
                </label>
              ))}
            </div>
          )}
          {checkedRows.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[#DEE7FF] flex justify-end text-xs font-bold text-[#062E63]">
              Total: {fmtMoney(total)}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !checkedRows.length}
            className="px-5 py-2 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
            {saving ? 'Creating…' : 'Create top-up invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InvoiceDashboard() {
  const router = useRouter()
  const [profile,    setProfile]    = useState(null)
  const [terms,      setTerms]      = useState([])
  const [termId,     setTermId]     = useState('')
  const [invoices,   setInvoices]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [generating, setGenerating] = useState(false)
  const [approvingId, setApprovingId] = useState(null)
  const [pdfGenId,   setPdfGenId]   = useState(null)
  const [error,      setError]      = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)
  const [creditModal,   setCreditModal]   = useState(null)  // { invoiceId, members }
  const [referralModal, setReferralModal] = useState(false)
  const [topUpModal,    setTopUpModal]    = useState(null)  // invoice object
  const [allStudents,   setAllStudents]   = useState([])
  const [statusEditing, setStatusEditing] = useState(null) // invoice id being status-edited

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(profile)
    })
    fetchAllTerms().then(setTerms)
  }, [router])

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
          .in('status', ['unpaid', 'overdue', 'awaiting_payment'])
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

      setInvoices(enriched)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [termId])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Load all students for referral modal
  useEffect(() => {
    supabase.from('students').select('id, full_name').order('full_name').then(({ data }) => setAllStudents(data || []))
  }, [])

  // ── Credit handler ────────────────────────────────────────────────────────
  const handleAddCredit = async ({ invoiceId, studentId, amount, reason, notes }) => {
    const { error: err } = await supabase.from('student_credits').insert({
      student_id: studentId, amount: Number(amount), reason,
      notes: notes?.trim() || null, invoice_id: invoiceId,
    })
    if (err) { setError('Failed to add credit: ' + err.message); return }
    const inv = invoices.find(i => i.id === invoiceId)
    if (inv) await supabase.from('invoices').update({ total: Math.max(0, Number(inv.total) - Number(amount)) }).eq('id', invoiceId)
    setCreditModal(null)
    await loadInvoices()
  }

  // ── Referral handler ──────────────────────────────────────────────────────
  const handleLogReferral = async ({ referringStudentId, referredStudentId }) => {
    const { error: refErr } = await supabase.from('referrals').insert({
      referring_student_id: referringStudentId, referred_student_id: referredStudentId,
    })
    if (refErr) { setError('Failed to log referral: ' + refErr.message); return }

    const { data: referredInv } = await supabase.from('invoices')
      .select('id, total').eq('student_id', referredStudentId).neq('status', 'paid')
      .order('id', { ascending: false }).limit(1).maybeSingle()

    await supabase.from('student_credits').insert({
      student_id: referredStudentId, amount: 50, reason: 'referral_referred',
      notes: 'Referral discount — welcome credit', invoice_id: referredInv?.id ?? null,
    })
    if (referredInv) {
      await supabase.from('invoices').update({ total: Math.max(0, Number(referredInv.total) - 50) }).eq('id', referredInv.id)
    }
    await supabase.from('student_credits').insert({
      student_id: referringStudentId, amount: 50, reason: 'referral_referring',
      notes: 'Referral reward — $50 off next invoice', invoice_id: null,
    })

    setReferralModal(false)
    setSuccessMsg('Referral logged. $50 applied to referred family; $50 pending for referring family\'s next invoice.')
    await loadInvoices()
  }

  // ── Status change handler ─────────────────────────────────────────────────
  const handleStatusChange = async (invoiceId, newStatus) => {
    setStatusEditing(invoiceId)
    try {
      const res = await fetch('/api/update-invoice-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, status: newStatus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: newStatus } : i))
    } catch (e) { setError('Status update failed: ' + e.message) }
    setStatusEditing(null)
  }

  const handleGenerate = async () => {
    setGenerating(true); setError(null); setSuccessMsg(null)
    try {
      const res  = await fetch('/api/generate-draft-invoices', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ term_id: termId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccessMsg(`Created ${data.created} draft invoice${data.created !== 1 ? 's' : ''}. ${data.skipped ? `${data.skipped} already existed.` : ''}`)
      await loadInvoices()
    } catch (e) { setError(e.message) } finally { setGenerating(false) }
  }

  const handleApprove = async (inv) => {
    setApprovingId(inv.id)
    try {
      const res = await fetch('/api/approve-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'approved' } : i))
    } catch (e) { setError(e.message) } finally { setApprovingId(null) }
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
    paid:     invoices.filter(i => i.status === 'paid').length,
    overdue:  invoices.filter(i => i.status === 'overdue').length,
    revenue:  invoices.filter(i => !['voided', 'draft'].includes(i.status)).reduce((s, i) => s + (Number(i.total) || 0), 0),
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
          <div className="flex items-center gap-2">
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
        </div>

        {error   && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>}
        {successMsg && <div className="bg-[#D1FAE5] border border-[#34D399] text-[#065F46] text-sm rounded-xl px-4 py-3 mb-5">{successMsg}</div>}

        {termId && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              {[
                { label: 'Total',    value: stats.total,                            cls: 'text-[#062E63]' },
                { label: 'Draft',    value: stats.draft,                            cls: 'text-[#325099]' },
                { label: 'Approved', value: stats.approved,                         cls: 'text-[#5B21B6]' },
                { label: 'Paid',     value: stats.paid,                             cls: 'text-[#065F46]' },
                { label: 'Overdue',  value: stats.overdue,                          cls: stats.overdue > 0 ? 'text-red-600' : 'text-[#325099]' },
                { label: 'Warnings', value: stats.warnings,                         cls: stats.warnings > 0 ? 'text-[#92400E]' : 'text-[#325099]' },
                { label: 'Revenue',  value: `$${stats.revenue.toLocaleString('en-AU', { minimumFractionDigits: 0 })}`, cls: 'text-[#062E63]' },
              ].map(s => (
                <div key={s.label} className="bg-white border border-[#DEE7FF] rounded-xl px-3 py-3 text-center">
                  <div className={`text-lg font-bold ${s.cls}`}>{s.value}</div>
                  <div className="text-[10px] text-[#325099]/60 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</div>
                </div>
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

            {invoices.length > 0 && (
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-[#325099]/60">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:bg-[#F0F4FF] transition disabled:opacity-40"
                >
                  {generating ? 'Generating…' : '+ Generate new drafts'}
                </button>
              </div>
            )}

            {/* Invoice table */}
            {loading ? (
              <div className="text-center py-16 text-[#325099]/40 text-sm">Loading invoices…</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                {invoices.map(inv => {
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
                  const creditLines   = (inv.line_items || []).filter(l => l.type === 'credit')

                  return (
                    <div key={inv.id} className={`bg-white rounded-2xl border overflow-hidden transition ${warnings.length ? 'border-[#FDE047]' : 'border-[#DEE7FF]'}`}>
                      {/* Invoice header */}
                      <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-[#DEE7FF]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#062E63]">{inv.invoice_number || `#${inv.id}`}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusStyle.cls}`}>{statusStyle.label}</span>
                            {inv.is_legacy && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-gray-500">Legacy</span>}
                            {warnings.map(w => <Warning key={w} text={w} />)}
                          </div>
                          <p className="text-sm font-semibold text-[#2A2035] mt-0.5">{inv.parent_name}</p>
                          <p className="text-xs text-[#325099]/50">{inv.parent_email || 'no email'}</p>
                          {inv.student_names?.length > 0 && (
                            <p className="text-xs text-[#325099]/70 mt-0.5">{inv.student_names.join(', ')}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold text-[#062E63]">{fmtMoney(total)}</p>
                          <p className="text-[10px] text-[#325099]/50">inc GST · due {fmtDate(inv.due_date)}</p>
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
                                <td className="py-1.5 text-[#065F46] italic" colSpan={2}>Credit: {l.reason}</td>
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
                          <button onClick={() => handleApprove(inv)} disabled={isApproving}
                            className="text-xs font-semibold bg-[#062E63] text-white px-4 py-1.5 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
                            {isApproving ? 'Approving…' : '✓ Approve'}
                          </button>
                        )}
                        {['approved', 'synced_to_xero', 'awaiting_payment', 'sent', 'paid', 'overdue'].includes(inv.status) && (
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
                        {!['voided', 'draft'].includes(inv.status) && (() => {
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
                        {inv.status === 'paid' && (
                          <button onClick={() => setTopUpModal(inv)}
                            className="text-xs font-semibold text-[#7C3AED] border border-[#EDE9FE] bg-white hover:bg-[#F5F3FF] px-4 py-1.5 rounded-full transition">
                            + Top-up
                          </button>
                        )}
                        {/* Status change */}
                        <select
                          value={inv.status}
                          disabled={statusEditing === inv.id}
                          onChange={e => handleStatusChange(inv.id, e.target.value)}
                          className="ml-auto text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1 bg-white focus:outline-none disabled:opacity-40"
                        >
                          {Object.entries(STATUS_LABELS).map(([v, s]) => (
                            <option key={v} value={v}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {!termId && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-16 text-center text-[#325099]/40 text-sm">
            Select a term to view invoices.
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
    </div>
  )
}
