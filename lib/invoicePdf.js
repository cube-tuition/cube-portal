/**
 * lib/invoicePdf.js — Server-side invoice PDF generation
 * Layout matches the Xero-style invoice format.
 */

const fmtMoney = n => (Number(n) || 0).toFixed(2)

const fmtDateLong = iso => {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

export async function generateInvoicePdfBuffer(inv, termName = '', termDates = '') {
  const { jsPDF } = await import('jspdf')

  const doc   = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W     = doc.internal.pageSize.getWidth()
  const H     = doc.internal.pageSize.getHeight()

  const navy      = [15,  43,  89]
  const blue      = [30,  100, 200]
  const black     = [20,  20,  20]
  const darkgrey  = [80,  80,  80]
  const midgrey   = [140, 140, 140]
  const linegrey  = [210, 210, 210]
  const L = 14
  const R = W - 14

  // ── Logo (navy hexagon with inner "C" ring) ──────────────────────────────
  const cx = R - 2, cy = 21, r = 14
  const hexPts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    hexPts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  doc.setFillColor(...navy)
  doc.setDrawColor(...navy)
  const segs = hexPts.slice(1).map((p, i) => [p[0] - hexPts[i][0], p[1] - hexPts[i][1]])
  doc.lines(segs, hexPts[0][0], hexPts[0][1], [1, 1], 'F', true)

  // Inner white "C" arc — drawn as a thick arc approximation
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(2.2)
  const arcR = 6.5
  const arcPts = []
  for (let i = 0; i <= 20; i++) {
    const a = (Math.PI * 0.2) + (Math.PI * 1.6) * (i / 20)
    arcPts.push([cx + arcR * Math.cos(a), cy + arcR * Math.sin(a)])
  }
  for (let i = 0; i < arcPts.length - 1; i++) {
    doc.line(arcPts[i][0], arcPts[i][1], arcPts[i+1][0], arcPts[i+1][1])
  }
  doc.setLineWidth(0.4)

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setTextColor(...black)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  const title = inv.status === 'draft' ? 'Draft Tax Invoice' : 'Tax Invoice'
  doc.text(title, L, 22)

  let y = 46

  // ── Address block ────────────────────────────────────────────────────────
  // Left: billing contact
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

  // Right: CUBE Tuition details
  let ry = y
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...black)
  doc.text('CUBE Tuition', R, ry, { align: 'right' }); ry += 5.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...darkgrey)
  doc.text('2 Help St', R, ry, { align: 'right' }); ry += 5
  doc.text('CHATSWOOD NSW 2067', R, ry, { align: 'right' }); ry += 6
  doc.text('ABN: 12685204335', R, ry, { align: 'right' }); ry += 5
  doc.text('admin@cubetuition.com.au', R, ry, { align: 'right' })

  y = Math.max(ly, ry) + 12

  // ── Key info bar ─────────────────────────────────────────────────────────
  doc.setDrawColor(...linegrey)
  doc.setLineWidth(0.4)
  doc.line(L, y, R, y)
  y += 8

  const totalIncGst = parseFloat(inv.total) || 0
  const issueDate   = inv.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)

  // Column widths: Amount due and Due date get more space
  const infoItems = [
    { label: 'Amount due',     value: `$${fmtMoney(totalIncGst)}`, size: 17 },
    { label: 'Due date',       value: fmtDateLong(inv.due_date),   size: 14 },
    { label: 'Issue date',     value: fmtDateLong(issueDate),      size: 11 },
    { label: 'Invoice number', value: inv.invoice_number || '—',   size: 11 },
    { label: 'Reference',      value: inv.reference_code  || '—',  size: 11 },
  ]

  // Give first two columns more width
  const colWidths = [38, 46, 36, 36, 30]
  let cx2 = L
  infoItems.forEach(({ label, value, size }, i) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...midgrey)
    doc.text(label, cx2, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...black)
    doc.text(value, cx2, y + (size >= 14 ? 9 : 7.5))
    cx2 += colWidths[i]
  })

  y += 20
  doc.setDrawColor(...linegrey)
  doc.setLineWidth(0.8)
  doc.line(L, y, R, y)
  doc.setLineWidth(0.4)
  y += 10

  // ── Table header ─────────────────────────────────────────────────────────
  const cDesc  = L
  const cQty   = 143
  const cPrice = 160
  const cTax   = 174
  const cAmt   = R

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...midgrey)
  doc.text('Description', cDesc, y)
  doc.text('Quantity', cQty, y, { align: 'center' })
  doc.text('Price', cPrice, y, { align: 'right' })
  doc.text('Tax', cTax, y, { align: 'center' })
  doc.text('Amount', cAmt, y, { align: 'right' })

  y += 4
  doc.setDrawColor(...linegrey)
  doc.line(L, y, R, y)
  y += 7

  // ── Table rows ────────────────────────────────────────────────────────────
  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
  const creditLines   = (inv.line_items || []).filter(l => l.type === 'credit')
  const allLines      = [...enrolLines, ...discountLines, ...creditLines]

  allLines.forEach(l => {
    const desc = l.type === 'enrolment'
      ? [l.student_name, l.class_name, l.day ? `${l.day}${l.start_time ? ' ' + l.start_time : ''}` : null]
          .filter(Boolean).join(' — ')
      : l.reason || (l.type === 'credit' ? 'Credit' : 'Discount')

    const amt      = Number(l.amount) || 0
    const price    = Number(l.unit_price ?? l.amount) || 0
    const taxLabel = amt !== 0 ? '10%' : ''

    const descLines = doc.splitTextToSize(desc, cQty - cDesc - 4)
    const rowH      = Math.max(10, descLines.length * 5.5 + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...black)
    doc.text(descLines, cDesc, y + 5)
    doc.text('1', cQty, y + 5, { align: 'center' })
    doc.text(fmtMoney(price), cPrice, y + 5, { align: 'right' })
    doc.setTextColor(...midgrey)
    doc.text(taxLabel, cTax, y + 5, { align: 'center' })
    doc.setTextColor(...black)
    doc.text(fmtMoney(amt), cAmt, y + 5, { align: 'right' })

    y += rowH
    doc.setDrawColor(...linegrey)
    doc.line(L, y, R, y)
    y += 4
  })

  y += 8

  // ── Payment instructions (left) + Totals (right) ─────────────────────────
  if (y > H - 65) { doc.addPage(); y = 20 }

  // Payment instructions — label in blue, then body text
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...blue)
  doc.text('Payment instructions', L, y)
  y += 6

  const instrRaw  = (inv.payment_instructions || 'Please contact admin@cubetuition.com.au for payment details.')
    .replace('[Invoice Number]', inv.invoice_number || '')
    .replace('[Reference]', inv.reference_code || inv.invoice_number || '')
  const instrLines = doc.splitTextToSize(instrRaw, 95)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...darkgrey)
  instrLines.forEach((line, i) => doc.text(line, L, y + i * 5))

  // Totals block (right)
  const gst = totalIncGst / 11
  const tx  = 128
  let   ty  = y - 6  // align with blue label

  const totRow = (label, value, bold = false, lineAbove = false) => {
    if (lineAbove) {
      doc.setDrawColor(...linegrey)
      doc.line(tx, ty - 2, R, ty - 2)
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...midgrey)
    doc.text(label, tx, ty)
    doc.setTextColor(...black)
    doc.text(value, R, ty, { align: 'right' })
    ty += 6
  }

  totRow('Subtotal', fmtMoney(totalIncGst))

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...midgrey)
  doc.text(`Includes GST of ${fmtMoney(gst)}`, tx, ty)
  ty += 6

  totRow('Total', fmtMoney(totalIncGst), false, true)

  ty += 2
  doc.setDrawColor(...linegrey)
  doc.line(tx, ty - 2, R, ty - 2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...midgrey)
  doc.text('Amount due', tx, ty + 7)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...black)
  doc.text(`$${fmtMoney(totalIncGst)}`, R, ty + 7, { align: 'right' })

  // ── Footer ────────────────────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(180, 185, 200)
    doc.text(
      `CUBE Tuition Pty Ltd  ·  ABN: 12685204335  ·  ${inv.invoice_number || ''}${inv.reference_code ? '  ·  ' + inv.reference_code : ''}  ·  Page ${p} of ${pages}`,
      W / 2, H - 8, { align: 'center' }
    )
  }

  return Buffer.from(doc.output('arraybuffer'))
}
