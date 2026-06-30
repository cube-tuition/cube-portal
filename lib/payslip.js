// Payslip PDF + email — per-tutor pay summary for a fortnight pay run.
// The PDF is generated client-side (jsPDF) and sent base64 to the
// /api/send-payslips route, which attaches it. Mirrors the invoice PDF style.
import { CUBE_LOGO_PNG, CUBE_LOGO_ASPECT } from './cubeLogo'

const NAVY  = [54, 68, 102]
const INK   = [42, 32, 53]
const GREY  = [120, 126, 140]
const FAINT = [225, 230, 242]

export const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// p = { tutorName, periodLabel, payMethod, shifts:[{date, description, hours, rate, amount}],
//       hours, gross, superAmount, total }
export async function buildPayslipPdfBase64(p) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const L = 16, R = W - 16

  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 3, 'F')
  const LOGO_W = 18
  doc.addImage(CUBE_LOGO_PNG, 'PNG', R - LOGO_W, 11, LOGO_W, LOGO_W * CUBE_LOGO_ASPECT)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(21); doc.setTextColor(...NAVY)
  doc.text('PAYSLIP', L, 22)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY)
  doc.text(p.periodLabel || '', L, 28.5)

  let y = 44
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY)
  doc.text('EMPLOYEE', L, y, { charSpace: 0.6 }); doc.text('FROM', R, y, { align: 'right', charSpace: 0.6 })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
  doc.text(p.tutorName || '', L, y + 6); doc.text('CUBE Tuition', R, y + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  doc.text(`Paid by ${p.payMethod === 'cash' ? 'cash' : 'bank transfer'}`, L, y + 11)
  doc.text('Chatswood', R, y + 11, { align: 'right' })
  if (p.paymentDate) doc.text(`Payment date: ${p.paymentDate}`, L, y + 15.5)

  // Shift table
  y += 26
  const cDate = L, cDesc = L + 24, cHrs = R - 56, cRate = R - 32, cAmt = R
  doc.setDrawColor(...FAINT); doc.setLineWidth(0.3); doc.line(L, y - 4, R, y - 4)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY)
  doc.text('DATE', cDate, y); doc.text('DESCRIPTION', cDesc, y)
  doc.text('HRS', cHrs, y, { align: 'right' }); doc.text('RATE', cRate, y, { align: 'right' }); doc.text('AMOUNT', cAmt, y, { align: 'right' })
  doc.line(L, y + 2, R, y + 2)

  y += 7
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  for (const s of p.shifts || []) {
    const desc = doc.splitTextToSize(s.description || '', cHrs - cDesc - 4)
    doc.text(s.date || '', cDate, y)
    doc.text(desc, cDesc, y)
    doc.text(Number(s.hours || 0).toFixed(2), cHrs, y, { align: 'right' })
    doc.text(s.rate == null ? '—' : money(s.rate), cRate, y, { align: 'right' })
    doc.text(money(s.amount), cAmt, y, { align: 'right' })
    y += Math.max(6, desc.length * 4.4)
    if (y > 250) { doc.addPage(); y = 24 }
  }

  // Totals
  y += 4; doc.setDrawColor(...FAINT); doc.line(R - 72, y, R, y); y += 7
  const line = (label, val, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 11 : 9.5)
    doc.setTextColor(...(bold ? NAVY : GREY)); doc.text(label, R - 48, y, { align: 'right' })
    doc.setTextColor(...(bold ? NAVY : INK)); doc.text(money(val), R, y, { align: 'right' })
    y += bold ? 8 : 6
  }
  line('Gross pay', p.gross)
  if (p.superAmount > 0) line('Superannuation (12%)', p.superAmount)
  line(p.superAmount > 0 ? 'Total incl. super' : 'Total', p.total, true)
  doc.setTextColor(...GREY)
  if (p.superYtd > 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    doc.text(`Super YTD (this quarter): ${money(p.superYtd)}`, R, y, { align: 'right' }); y += 5
  }
  if (p.superAmount > 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
    doc.text('Superannuation is paid to your nominated fund, on top of your pay.', R, y, { align: 'right' })
  }

  return doc.output('datauristring').split('base64,')[1]
}

export const payslipSubject = (periodLabel) => `Your CUBE payslip — ${periodLabel}`

export function buildPayslipEmailHtml(p) {
  const first = (p.tutorName || 'there').split(' ')[0]
  const row = (l, v, strong) => `<tr><td style="padding:5px 0;color:#787e8c;font-size:13px;">${l}</td><td style="padding:5px 0;text-align:right;color:#2A2035;font-size:13px;font-weight:${strong ? 700 : 600};">${v}</td></tr>`
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:30px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      </div>
      <div style="font-size:15px;line-height:1.7;">
        <p style="margin:0 0 14px;">Hi ${first},</p>
        <p style="margin:0 0 18px;">Here's your payslip for <strong>${p.periodLabel}</strong>. Your full shift breakdown is attached as a PDF.</p>
        <table style="width:100%;border-collapse:collapse;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:0;margin:0 0 18px;">
          <tbody style="display:table;width:100%;padding:8px 16px;box-sizing:border-box;">
            ${p.paymentDate ? row('Payment date', p.paymentDate) : ''}
            ${row('Hours', Number(p.hours || 0).toFixed(2))}
            ${row('Gross pay', money(p.gross))}
            ${p.superAmount > 0 ? row('Superannuation (12%)', money(p.superAmount)) : ''}
            ${row('Total', money(p.total), true)}
            ${p.superYtd > 0 ? row('Super YTD (this quarter)', money(p.superYtd)) : ''}
          </tbody>
        </table>
        <p style="margin:0 0 14px;">Paid by ${p.payMethod === 'cash' ? 'cash' : 'bank transfer'}. Thanks for your great work this fortnight!</p>
        <p style="margin:0;">— The CUBE Team</p>
      </div>
    </div>
  </body></html>`
}
