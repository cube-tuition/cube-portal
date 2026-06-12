// ── Invoice PDF generation (client-side jsPDF, Xero-style layout) ────────────
// Pure utility — no React. Imported by the invoice page and SendEmailModal.
import { fmtDateLong } from './format'

export async function generateInvoicePdf(inv, termName, termDates) {
  const { jsPDF } = await import('jspdf')

  const doc      = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W        = doc.internal.pageSize.getWidth()   // 210mm
  const H        = doc.internal.pageSize.getHeight()  // 297mm
  const navy     = [15,  43,  89]
  const blue     = [30,  100, 200]
  const black    = [20,  20,  20]
  const darkgrey = [80,  80,  80]
  const midgrey  = [140, 140, 140]
  const linegrey = [210, 210, 210]
  const L = 14
  const R = W - 14

  const num = n => (Number(n) || 0).toFixed(2)

  const logoCx = R - 2, logoCy = 21, logoR = 14
  const hexPts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    hexPts.push([logoCx + logoR * Math.cos(a), logoCy + logoR * Math.sin(a)])
  }
  doc.setFillColor(...navy)
  doc.setDrawColor(...navy)
  const segs = hexPts.slice(1).map((p, i) => [p[0] - hexPts[i][0], p[1] - hexPts[i][1]])
  doc.lines(segs, hexPts[0][0], hexPts[0][1], [1, 1], 'F', true)
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(2.2)
  const arcPts = []
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * 0.2 + Math.PI * 1.6 * (i / 20)
    arcPts.push([logoCx + 6.5 * Math.cos(a), logoCy + 6.5 * Math.sin(a)])
  }
  for (let i = 0; i < arcPts.length - 1; i++) {
    doc.line(arcPts[i][0], arcPts[i][1], arcPts[i + 1][0], arcPts[i + 1][1])
  }
  doc.setLineWidth(0.4)

  doc.setTextColor(...black)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(inv.status === 'draft' ? 'Draft Tax Invoice' : 'Tax Invoice', L, 22)

  let y = 46

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...black)
  doc.text(inv.parent_name || '—', L, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...darkgrey)
  let ly = y + 5.5
  if (inv.parent_email) { doc.text(inv.parent_email, L, ly); ly += 5 }
  if (inv.parent_phone) { doc.text(inv.parent_phone, L, ly); ly += 5 }

  let ry = y
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...black)
  doc.text('CUBE Tuition', R, ry, { align: 'right' }); ry += 5.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...darkgrey)
  doc.text('2 Help St', R, ry, { align: 'right' }); ry += 5
  doc.text('CHATSWOOD NSW 2067', R, ry, { align: 'right' }); ry += 5.5
  doc.text('ABN: 12685204335', R, ry, { align: 'right' }); ry += 5
  doc.text('admin@cubetuition.com.au', R, ry, { align: 'right' })

  y = Math.max(ly, ry) + 10

  doc.setDrawColor(...linegrey)
  doc.setLineWidth(0.4)
  doc.line(L, y, R, y)
  y += 7

  const totalIncGst = parseFloat(inv.total) || 0
  const issueDate   = inv.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)

  const infoItems = [
    { label: 'Amount due',     value: '$' + num(totalIncGst),    size: 16 },
    { label: 'Due date',       value: fmtDateLong(inv.due_date), size: 13 },
    { label: 'Issue date',     value: fmtDateLong(issueDate),    size: 10 },
    { label: 'Invoice number', value: inv.invoice_number || '—', size: 10 },
    { label: 'Reference',      value: inv.reference_code || '—', size: 10 },
  ]
  const colWidths = [38, 46, 34, 34, 30]
  let colX = L
  infoItems.forEach(({ label, value, size }, i) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...midgrey)
    doc.text(label, colX, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...black)
    doc.text(value, colX, y + 8)
    colX += colWidths[i]
  })

  y += 19
  doc.setDrawColor(...linegrey)
  doc.setLineWidth(0.8)
  doc.line(L, y, R, y)
  doc.setLineWidth(0.4)
  y += 9

  const cDesc  = L
  const cQty   = 140
  const cPrice = 157
  const cTax   = 172
  const cAmt   = R

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...midgrey)
  doc.text('Description', cDesc,  y)
  doc.text('Qty',         cQty,   y, { align: 'center' })
  doc.text('Price',       cPrice, y, { align: 'right' })
  doc.text('Tax',         cTax,   y, { align: 'center' })
  doc.text('Amount',      cAmt,   y, { align: 'right' })

  y += 3
  doc.setDrawColor(...linegrey)
  doc.line(L, y, R, y)
  y += 6

  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
  const creditLines2  = (inv.line_items || []).filter(l => l.type === 'credit')
  const allLines      = [...enrolLines, ...discountLines, ...creditLines2]

  const LINE_H  = 5
  const ROW_PAD = 4

  allLines.forEach(l => {
    const desc = l.type === 'enrolment'
      ? [l.student_name, l.class_name, l.day ? (l.day + (l.start_time ? ' ' + l.start_time : '')) : null]
          .filter(Boolean).join(' — ')
      : l.reason || (l.type === 'credit' ? 'Credit' : 'Discount')

    const amt      = Number(l.amount) || 0
    const price    = Number(l.unit_price ?? l.amount) || 0
    const taxLabel = amt !== 0 ? '10%' : ''

    const descLines = doc.splitTextToSize(desc, cQty - cDesc - 6)
    const textH     = descLines.length * LINE_H
    const rowH      = textH + ROW_PAD * 2

    if (y + rowH > H - 55) { doc.addPage(); y = 20 }

    const textY = y + ROW_PAD + LINE_H - 1

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...black)
    doc.text(descLines, cDesc, textY)
    doc.text('1',        cQty,   textY, { align: 'center' })
    doc.text(num(price), cPrice, textY, { align: 'right' })
    doc.setTextColor(...midgrey)
    doc.text(taxLabel,   cTax,   textY, { align: 'center' })
    doc.setTextColor(...black)
    doc.text(num(amt),   cAmt,   textY, { align: 'right' })

    y += rowH
    doc.setDrawColor(...linegrey)
    doc.line(L, y, R, y)
  })

  y += 10

  if (y > H - 60) { doc.addPage(); y = 20 }

  const sectionY = y

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...blue)
  doc.text('Payment instructions', L, sectionY)

  const instrRaw = (inv.payment_instructions || 'Please contact admin@cubetuition.com.au for payment details.')
    .replace('[Invoice Number]', inv.invoice_number || '')
    .replace('[Reference]', inv.reference_code || inv.invoice_number || '')
  const instrLines = doc.splitTextToSize(instrRaw, 100)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...darkgrey)
  instrLines.forEach((line, i) => doc.text(line, L, sectionY + 6 + i * 5))

  const gst = totalIncGst / 11
  const tx  = 125
  let   ty  = sectionY

  const totRow = (label, value, lineAbove) => {
    if (lineAbove) {
      doc.setDrawColor(...linegrey)
      doc.line(tx, ty - 2, R, ty - 2)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...midgrey)
    doc.text(label, tx, ty)
    doc.setTextColor(...black)
    doc.text(value, R, ty, { align: 'right' })
    ty += 6
  }

  totRow('Subtotal', num(totalIncGst))

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...midgrey)
  doc.text('Includes GST of ' + num(gst), tx, ty)
  ty += 6

  totRow('Total', num(totalIncGst), true)

  ty += 3
  doc.setDrawColor(...linegrey)
  doc.line(tx, ty - 2, R, ty - 2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...midgrey)
  doc.text('Amount due', tx, ty + 6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...black)
  doc.text('$' + num(totalIncGst), R, ty + 6, { align: 'right' })

  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(180, 185, 200)
    doc.text(
      'CUBE Tuition Pty Ltd  ·  ABN: 12685204335  ·  ' +
      (inv.invoice_number || '') +
      (inv.reference_code ? '  ·  ' + inv.reference_code : '') +
      '  ·  Page ' + p + ' of ' + pages,
      W / 2, H - 8, { align: 'center' }
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
