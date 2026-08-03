// ── Payment receipt PDF (jsPDF) ──────────────────────────────────────────────
// Pure utility — no React. Deliberately NOT the invoice template: a receipt
// attests that money arrived, so it leads with one number (the amount paid) and
// the facts around it, with no line items, no GST breakdown and no payment
// instructions. Green where the invoice is navy, so the two can never be
// mistaken for each other in a stack of PDFs.
//
// Receipt numbers are derived from the invoice (R-26T3-0194 for 26T3-0194):
// no separate counter to maintain, and every receipt traces straight back to
// its invoice.
import { fmtDateLong } from './format'
import { CUBE_LOGO_PNG, CUBE_LOGO_ASPECT } from './cubeLogo'

const GREEN  = [6, 95, 70]      // #065F46 — the portal's "paid" colour
const TINT   = [236, 253, 245]  // #ECFDF5 — light green panel
const INK    = [42, 32, 53]     // body text
const GREY   = [120, 126, 140]  // labels
const FAINT  = [225, 230, 242]  // rules

const money = (n) => {
  const v = Number(n) || 0
  const abs = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '-$' : '$') + abs
}

export const receiptNumber = (inv) => `R-${inv?.invoice_number || String(inv?.id ?? '')}`

const METHOD_LABELS = { cash: 'Cash', bank: 'Bank transfer' }
export const paymentMethodLabel = (inv) =>
  METHOD_LABELS[inv?.payment_method] || 'Bank transfer'

/**
 * generateReceiptPdf(inv, termName, paidDateISO) → jsPDF doc
 * `paidDateISO` (YYYY-MM-DD) is passed in rather than read off the invoice so
 * the send modal can let staff correct an unrecorded paid date before sending.
 */
export async function generateReceiptPdf(inv, termName, paidDateISO) {
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()   // 210
  const L = 16
  const R = W - 16

  // ── Top accent bar ──────────────────────────────────────────────────────────
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, W, 3, 'F')

  // ── Header: title left, logo right ─────────────────────────────────────────
  const LOGO_W = 18
  doc.addImage(CUBE_LOGO_PNG, 'PNG', R - LOGO_W, 11, LOGO_W, LOGO_W * CUBE_LOGO_ASPECT)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(21)
  doc.setTextColor(...GREEN)
  doc.text('RECEIPT', L, 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...GREY)
  const subBits = [receiptNumber(inv), termName].filter(Boolean).join('   ·   ')
  if (subBits) doc.text(subBits, L, 28.5)

  doc.setDrawColor(...FAINT)
  doc.setLineWidth(0.4)
  doc.line(L, 34, R, 34)

  // ── From / To ───────────────────────────────────────────────────────────────
  let y = 42
  doc.setFontSize(8)
  doc.setTextColor(...GREY)
  doc.text('FROM', L, y)
  doc.text('RECEIVED FROM', W / 2, y)
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold')
  doc.text('CUBE Tuition', L, y + 5.5)
  doc.text(inv.parent_name || '—', W / 2, y + 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GREY)
  doc.text('admin@cubetuition.com.au', L, y + 10.5)
  if (inv.parent_email) doc.text(String(inv.parent_email), W / 2, y + 10.5)

  // ── The number that matters ────────────────────────────────────────────────
  y = 62
  const PANEL_H = 34
  doc.setFillColor(...TINT)
  doc.setDrawColor(...GREEN)
  doc.setLineWidth(0.5)
  doc.roundedRect(L, y, R - L, PANEL_H, 2.5, 2.5, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GREEN)
  doc.text('AMOUNT PAID', W / 2, y + 10, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.text(money(inv.total), W / 2, y + 24, { align: 'center' })

  // ── Payment details ────────────────────────────────────────────────────────
  y += PANEL_H + 14
  const rows = [
    ['Paid on',        paidDateISO ? fmtDateLong(paidDateISO) : '—'],
    ['Payment method', paymentMethodLabel(inv)],
    ['Students',       (inv.student_names || []).join(', ') || '—'],
    ['Term',           termName || '—'],
    ['For invoice',    inv.invoice_number || '—'],
  ]
  doc.setLineWidth(0.3)
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text(label, L, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text(String(value), 70, y)
    doc.setDrawColor(...FAINT)
    doc.line(L, y + 3.5, R, y + 3.5)
    y += 10
  }

  // ── Closing note ───────────────────────────────────────────────────────────
  y += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...INK)
  doc.text('This receipt confirms the above payment has been received in full. Thank you.', L, y)

  doc.setFontSize(8.5)
  doc.setTextColor(...GREY)
  doc.text('CUBE Tuition · Chatswood · admin@cubetuition.com.au', L, 285)

  return doc
}
