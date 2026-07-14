// ── Invoice PDF generation (jsPDF) ───────────────────────────────────────────
// Pure utility — no React. Imported by the invoice page, SendEmailModal and
// (via generateInvoicePdfBuffer) the email API routes.
//
// Design language matches the portal: brand navy #364466 (the logo colour),
// soft blue panels, one accent rule, consistent typography. Real logo from
// lib/cubeLogo.js. Draft invoices get a light DRAFT watermark.
import { fmtDateLong } from './format'
import { CUBE_LOGO_PNG, CUBE_LOGO_ASPECT } from './cubeLogo'

const NAVY   = [54, 68, 102]    // #364466 — brand / logo colour
const INK    = [42, 32, 53]     // body text
const GREY   = [120, 126, 140]  // labels
const FAINT  = [225, 230, 242]  // rules
const PANEL  = [240, 244, 255]  // light blue panel fill (#F0F4FF)
const WHITE  = [255, 255, 255]

const money = (n) => {
  const v = Number(n) || 0
  const abs = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '-$' : '$') + abs
}

export async function generateInvoicePdf(inv, termName, termDates) {
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()   // 210
  const H = doc.internal.pageSize.getHeight()  // 297
  const L = 16
  const R = W - 16
  const isDraft = inv.status === 'draft'

  // ── Top accent bar ──────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 3, 'F')

  // ── Header: title left, logo right ─────────────────────────────────────────
  const LOGO_W = 18
  doc.addImage(CUBE_LOGO_PNG, 'PNG', R - LOGO_W, 11, LOGO_W, LOGO_W * CUBE_LOGO_ASPECT)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(21)
  doc.setTextColor(...NAVY)
  doc.text('TAX INVOICE', L, 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...GREY)
  const subBits = [inv.invoice_number, termName].filter(Boolean).join('   ·   ')
  if (subBits) doc.text(subBits, L, 28.5)

  if (isDraft) {
    // status chip next to title
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.4)
    doc.roundedRect(L + 52, 16.2, 18, 7, 1.4, 1.4, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...NAVY)
    doc.text('DRAFT', L + 61, 20.8, { align: 'center', charSpace: 0.4 })
  }

  // ── Billed to / From blocks ─────────────────────────────────────────────────
  let y = 42
  const block = (x, align, heading, lines) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...GREY)
    doc.text(heading.toUpperCase(), x, y, { align, charSpace: 0.6 })
    let by = y + 6
    lines.forEach(([text, bold], i) => {
      if (!text) return
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 10.5 : 9)
      doc.setTextColor(...(bold ? INK : GREY))
      doc.text(text, x, by, { align })
      by += bold ? 5.6 : 4.8
    })
    return by
  }
  const lEnd = block(L, 'left', 'Billed to', [
    [inv.parent_name || '—', true],
    [inv.parent_email, false],
    [inv.parent_phone, false],
  ])
  const rEnd = block(R, 'right', 'From', [
    ['CUBE Tuition', true],
    ['2 Help St, Chatswood NSW 2067', false],
    ['ABN 12 685 204 335', false],
    ['admin@cubetuition.com.au', false],
  ])
  y = Math.max(lEnd, rEnd) + 6

  // ── Key facts strip — white card, hairline border, column dividers ─────────
  const stripH = 20
  doc.setDrawColor(...FAINT)
  doc.setLineWidth(0.4)
  doc.roundedRect(L, y, R - L, stripH, 1.5, 1.5, 'S')
  const facts = [
    ['Amount due',     money(inv.total), true],
    ['Due date',       fmtDateLong(inv.due_date) || '—', false],
    ['Issue date',     fmtDateLong(inv.created_at?.slice(0, 10)) || '—', false],
    ['Reference',      inv.reference_code || inv.invoice_number || '—', false],
  ]
  const cellW = (R - L) / facts.length
  facts.forEach(([label, value, hero], i) => {
    const cx = L + cellW * i + 7
    if (i > 0) doc.line(L + cellW * i, y + 4, L + cellW * i, y + stripH - 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.6)
    doc.setTextColor(...GREY)
    doc.text(label.toUpperCase(), cx, y + 7.2, { charSpace: 0.5 })
    doc.setFont('helvetica', hero ? 'bold' : 'normal')
    doc.setFontSize(hero ? 13.5 : 10)
    doc.setTextColor(...(hero ? NAVY : INK))
    doc.text(value, cx, y + 14.8)
  })
  y += stripH + 12

  // ── Items table ─────────────────────────────────────────────────────────────
  const cDesc  = L + 5
  const cQty   = R - 40
  const cAmt   = R - 5

  const drawTableHeader = () => {
    doc.setFillColor(...NAVY)
    doc.roundedRect(L, y - 5.4, R - L, 8.4, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...WHITE)
    doc.text('DESCRIPTION', cDesc, y, { charSpace: 0.5 })
    doc.text('QTY', cQty, y, { align: 'right', charSpace: 0.5 })
    doc.text('AMOUNT', cAmt, y, { align: 'right', charSpace: 0.5 })
    y += 8
  }
  drawTableHeader()

  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
  // Credits: dated ones (absences) first, chronologically; undated (referral
  // rewards etc.) after, in saved order.
  const MONTHS_IDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  const creditDate = (reason) => {
    const m = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i.exec(reason || '')
    return m ? new Date(Number(m[3]), MONTHS_IDX[m[2].slice(0, 3).toLowerCase()], Number(m[1])).getTime() : null
  }
  const creditLines   = (inv.line_items || []).filter(l => l.type === 'credit').sort((a, b) => {
    const da = creditDate(a.reason), db = creditDate(b.reason)
    if (da != null && db != null) return da - db
    if (da != null) return -1
    if (db != null) return 1
    return 0
  })
  // Manually added lines (type 'adjustment' or anything else) render last.
  const otherLines    = (inv.line_items || []).filter(l => !['enrolment', 'discount', 'credit'].includes(l.type))
  const allLines      = [...enrolLines, ...discountLines, ...creditLines, ...otherLines]

  const LINE_H = 4.6
  let zebra = false

  allLines.forEach(l => {
    const isEnrol = l.type === 'enrolment'
    const title = isEnrol
      ? (l.student_name || 'Student') + (l.class_name ? ' — ' + l.class_name : '')
      : (l.reason || (l.type === 'credit' ? 'Credit' : l.type === 'discount' ? 'Discount' : 'Adjustment'))
    const sub = null   // day/time deliberately not shown on invoice lines

    const amt = Number(l.amount) || 0

    const titleLines = doc.splitTextToSize(title, cQty - cDesc - 14)
    const rowH = titleLines.length * LINE_H + (sub ? 4.2 : 0) + 6

    if (y + rowH > H - 78) {
      doc.addPage(); y = 20; drawTableHeader(); zebra = false
    }

    if (zebra) {
      doc.setFillColor(247, 249, 254)
      doc.rect(L, y - 4.6, R - L, rowH, 'F')
    }
    zebra = !zebra

    const textY = y + 0.6
    doc.setFont('helvetica', isEnrol ? 'bold' : 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(titleLines, cDesc, textY)
    if (sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.8)
      doc.setTextColor(...GREY)
      doc.text(sub, cDesc, textY + titleLines.length * LINE_H)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text('1', cQty, textY, { align: 'right' })
    doc.setTextColor(...(amt < 0 ? GREY : INK))
    doc.text(money(amt), cAmt, textY, { align: 'right' })

    y += rowH
    doc.setDrawColor(...FAINT)
    doc.setLineWidth(0.3)
    doc.line(L, y - 4.6, R, y - 4.6)
  })

  y += 8
  if (y > H - 88) { doc.addPage(); y = 24 }

  // ── Bottom row: payment instructions (left) + totals (right) ───────────────
  const totalIncGst = Number(inv.total) || 0
  const gst = totalIncGst / 11
  const boxTop = y

  // Payment instructions panel
  const instrRaw = (inv.payment_instructions || 'Please contact admin@cubetuition.com.au for payment details.')
    .replace('[Invoice Number]', inv.invoice_number || '')
    .replace('[Reference]', inv.reference_code || inv.invoice_number || '')
  const instrW = 98
  const instrLines = doc.splitTextToSize(instrRaw, instrW - 14)
  const instrH = Math.max(30, instrLines.length * 4.4 + 16)
  doc.setDrawColor(...FAINT)
  doc.setLineWidth(0.4)
  doc.roundedRect(L, boxTop, instrW, instrH, 1.5, 1.5, 'S')
  doc.setFillColor(...NAVY)
  doc.rect(L, boxTop + 3, 1.1, instrH - 6, 'F')   // slim accent edge
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...NAVY)
  doc.text('HOW TO PAY', L + 7, boxTop + 8, { charSpace: 0.6 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.3)
  doc.setTextColor(...INK)
  doc.text(instrLines, L + 7, boxTop + 14.5)

  // Totals
  const tx = L + instrW + 14
  let ty = boxTop + 4
  const totRow = (label, value) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GREY)
    doc.text(label, tx, ty)
    doc.setTextColor(...INK)
    doc.text(value, R, ty, { align: 'right' })
    ty += 6.2
  }
  totRow('Subtotal', money(totalIncGst))
  totRow('Total (excluding GST)', money(totalIncGst - gst))
  totRow('GST (10%)', money(gst))

  // Amount due band
  ty += 5
  doc.setFillColor(...NAVY)
  doc.roundedRect(tx - 4, ty - 5.2, R - tx + 9, 11.6, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...WHITE)
  doc.text('AMOUNT DUE', tx, ty + 1.6, { charSpace: 0.4 })
  doc.setFontSize(13.5)
  doc.text(money(totalIncGst), R, ty + 1.8, { align: 'right' })

  // ── Draft watermark + footer on every page ──────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (isDraft && typeof doc.saveGraphicsState === 'function' && doc.GState) {
      doc.saveGraphicsState()
      doc.setGState(new doc.GState({ opacity: 0.06 }))
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(92)
      doc.setTextColor(...NAVY)
      doc.text('DRAFT', W / 2, H / 2 + 25, { align: 'center', angle: 32 })
      doc.restoreGraphicsState()
    }
    doc.setDrawColor(...FAINT)
    doc.setLineWidth(0.3)
    doc.line(L, H - 14, R, H - 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GREY)
    doc.text(
      'CUBE Tuition Pty Ltd · ABN 12 685 204 335 · ' + (inv.invoice_number || 'Invoice') +
      ' · Page ' + p + ' of ' + pages,
      W / 2, H - 9, { align: 'center' }
    )
  }

  return doc
}

// Server-side helper: returns the invoice PDF as a Node Buffer. Used by API
// routes (send-payment-confirmation, send-term-start-emails) that email the PDF
// as an attachment, where a Buffer — not a jsPDF doc — is required.
export async function generateInvoicePdfBuffer(inv, termName, termDates) {
  const doc = await generateInvoicePdf(inv, termName, termDates)
  return Buffer.from(doc.output('arraybuffer'))
}
