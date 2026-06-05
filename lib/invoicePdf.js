/**
 * lib/invoicePdf.js — Server-side invoice PDF generation
 *
 * Shared between:
 *   - API routes (returns Buffer for email attachments)
 *   - Client page (generateInvoicePdf in page.js uses the same layout logic)
 *
 * Usage:
 *   import { generateInvoicePdfBuffer } from '../../../lib/invoicePdf'
 *   const buf = await generateInvoicePdfBuffer(inv, termName, termDates)
 *   // attach as: { filename: `${inv.invoice_number}.pdf`, content: buf }
 */

const fmtMoney = n => `$${(Number(n) || 0).toFixed(2)}`
const fmtDate  = iso => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

export async function generateInvoicePdfBuffer(inv, termName = '', termDates = '') {
  const { jsPDF } = await import('jspdf')

  const doc   = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W     = doc.internal.pageSize.getWidth()
  const H     = doc.internal.pageSize.getHeight()
  const navy  = [6, 46, 99]
  const grey  = [120, 130, 155]
  const light = [230, 235, 245]

  // ── Header bar ──────────────────────────────────────────────────────────────
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

  // ── Invoice meta (top-right) ─────────────────────────────────────────────
  let y = 35
  const metaLeft  = W - 85
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
  if (termDates)        { doc.setFontSize(8); doc.text(`Term: ${termDates}`, 14, ly); ly += 5 }

  // ── Divider ──────────────────────────────────────────────────────────────
  const tableStartY = Math.max(y, ly) + 6
  doc.setDrawColor(...light)
  doc.line(14, tableStartY - 3, W - 14, tableStartY - 3)

  // ── Table header ─────────────────────────────────────────────────────────
  const cols = { student: 14, description: 50, qty: 118, unitPrice: 134, amount: 166 }
  const rowH  = 7

  doc.setFillColor(...navy)
  doc.rect(14, tableStartY, W - 28, rowH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(255, 255, 255)
  doc.text('Student',      cols.student + 2,    tableStartY + 4.5)
  doc.text('Class / Schedule', cols.description + 2, tableStartY + 4.5)
  doc.text('Qty',          cols.qty + 2,         tableStartY + 4.5, { align: 'center' })
  doc.text('Unit price',   cols.unitPrice + 16,  tableStartY + 4.5, { align: 'right' })
  doc.text('Amount',       W - 15,               tableStartY + 4.5, { align: 'right' })

  // ── Table rows ────────────────────────────────────────────────────────────
  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
  const creditLines   = (inv.line_items || []).filter(l => l.type === 'credit')
  let ry = tableStartY + rowH

  // textColor: null = black, array = rgb
  const drawRow = (studentName, description, qty, unitPrice, amount, shade, textColor = null) => {
    const lines  = doc.splitTextToSize(description, 60)
    const cellH  = Math.max(rowH, lines.length * 4.5 + 3)
    if (shade) { doc.setFillColor(248, 250, 255); doc.rect(14, ry, W - 28, cellH, 'F') }
    doc.setDrawColor(...light); doc.line(14, ry + cellH, W - 28 + 14, ry + cellH)
    const tc = textColor || [0, 0, 0]
    doc.setFont('helvetica', textColor ? 'italic' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...tc)
    doc.text(studentName,  cols.student + 2,    ry + 5)
    doc.text(lines,        cols.description + 2, ry + 5)
    doc.text(qty,          cols.qty + 2,         ry + 5, { align: 'center' })
    doc.text(unitPrice,    cols.unitPrice + 16,  ry + 5, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(amount,       W - 15,               ry + 5, { align: 'right' })
    ry += cellH
  }

  enrolLines.forEach((l, i) => {
    const desc = [
      l.class_name,
      l.day ? `${l.day}${l.start_time ? ', ' + l.start_time : ''}` : '',
    ].filter(Boolean).join(' · ')
    drawRow(l.student_name, desc, '1', fmtMoney(l.unit_price), fmtMoney(l.amount), i % 2 === 1)
  })

  discountLines.forEach((l, i) => {
    drawRow('', l.reason || 'Discount', '', '', `(${fmtMoney(Math.abs(l.amount))})`,
      (enrolLines.length + i) % 2 === 1, [92, 58, 237])  // purple
  })

  creditLines.forEach((l, i) => {
    drawRow('', l.reason || 'Credit applied', '', '', `(${fmtMoney(Math.abs(l.amount))})`,
      (enrolLines.length + discountLines.length + i) % 2 === 1, [5, 95, 70])  // green
  })

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalIncGst = parseFloat(inv.total) || 0
  const gst         = totalIncGst / 11
  let ty2      = ry + 6
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

  if (inv.sibling_discount > 0)      addTotRow('Sibling discount',     `(${fmtMoney(inv.sibling_discount)})`)
  if (inv.multi_course_discount > 0) addTotRow('Multi-course discount', `(${fmtMoney(inv.multi_course_discount)})`)
  addTotRow('GST (included)', fmtMoney(gst))

  doc.setDrawColor(...light); doc.line(totalsL, ty2 - 3, W - 14, ty2 - 3)
  doc.setFillColor(...navy)
  doc.roundedRect(totalsL - 2, ty2 - 1, W - totalsL + 2 - 14 + 2, 11, 2, 2, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255)
  doc.text('TOTAL DUE (inc GST)', totalsL + 2, ty2 + 7)
  doc.text(fmtMoney(totalIncGst), W - 16, ty2 + 7, { align: 'right' })
  ty2 += 18

  // ── Payment instructions ──────────────────────────────────────────────────
  if (ty2 > H - 40) { doc.addPage(); ty2 = 20 }
  doc.setDrawColor(...light); doc.line(14, ty2, W - 14, ty2); ty2 += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0)
  doc.text('Payment Instructions', 14, ty2); ty2 += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey)
  const instrText = (inv.payment_instructions || 'Please contact admin@cubetuition.com.au for payment details.')
    .replace('[Invoice Number]', inv.invoice_number || '')
  const instrLines = doc.splitTextToSize(instrText, W - 28)
  doc.text(instrLines, 14, ty2)

  // ── Footer on every page ──────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7); doc.setTextColor(180, 185, 200)
    doc.text(
      `CUBE Tuition Pty Ltd  ·  ABN: XX XXX XXX XXX  ·  ${inv.invoice_number || ''}  ·  Page ${p} of ${pages}`,
      W / 2, H - 8, { align: 'center' }
    )
  }

  return Buffer.from(doc.output('arraybuffer'))
}
