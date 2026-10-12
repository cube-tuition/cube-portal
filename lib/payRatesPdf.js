// Pay Rates PDF — the "Pay rate" document the Employment Agreement (clause 4)
// refers to, built from a tutor's rates in Payroll → Rates (current_tutor_rates)
// and attached to their onboarding email. Generated client-side with jsPDF and
// sent base64 to /api/onboarding/send, like payslips. Mirrors the payslip style.
import { CUBE_LOGO_PNG, CUBE_LOGO_ASPECT } from './cubeLogo'

const NAVY  = [54, 68, 102]
const INK   = [42, 32, 53]
const GREY  = [120, 126, 140]
const FAINT = [225, 230, 242]

export const RATE_BANDS = [
  { band: '1-6',   label: 'Years 1–6' },
  { band: '7-8',   label: 'Years 7–8' },
  { band: '9-10',  label: 'Years 9–10' },
  { band: '11-12', label: 'Years 11–12' },
  { band: 'other', label: 'Other (e.g. homework help)' },
]
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// rates: current_tutor_rates rows [{ year_band, mode: 'class'|'tutor', hourly_rate, effective_from }]
// Returns the bands that have at least one rate, with class and 1:1 figures.
export function rateRows(rates = []) {
  return RATE_BANDS.map(b => {
    const find = (mode) => rates.find(r => r.year_band === b.band && r.mode === mode)?.hourly_rate
    return { ...b, cls: find('class'), one: find('tutor') }
  }).filter(r => r.cls != null || r.one != null)
}

// p = { tutorName, rates, payMethod, superRate (e.g. 0.12), effectiveFrom }
export async function buildPayRatesPdfBase64(p) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const L = 16, R = W - 16

  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 3, 'F')
  const LOGO_W = 18
  doc.addImage(CUBE_LOGO_PNG, 'PNG', R - LOGO_W, 11, LOGO_W, LOGO_W * CUBE_LOGO_ASPECT)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(21); doc.setTextColor(...NAVY)
  doc.text('PAY RATES', L, 22)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GREY)
  doc.text('Casual hourly rates', L, 28.5)

  let y = 44
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY)
  doc.text('EMPLOYEE', L, y, { charSpace: 0.6 }); doc.text('EMPLOYER', R, y, { align: 'right', charSpace: 0.6 })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
  doc.text(p.tutorName || '', L, y + 6); doc.text('CUBE Tuition Pty Ltd', R, y + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  doc.text('Casual employee', L, y + 11)
  doc.text('Chatswood NSW', R, y + 11, { align: 'right' })
  if (p.effectiveFrom) doc.text(`Effective from ${p.effectiveFrom}`, L, y + 15.5)

  // Rate table
  y += 28
  const cBand = L, cCls = R - 50, cOne = R
  doc.setDrawColor(...FAINT); doc.setLineWidth(0.3); doc.line(L, y - 4, R, y - 4)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY)
  doc.text('YEAR GROUP', cBand, y)
  doc.text('GROUP CLASS / HR', cCls, y, { align: 'right' })
  doc.text('1:1 TUTORING / HR', cOne, y, { align: 'right' })
  doc.line(L, y + 2, R, y + 2)
  y += 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK)
  for (const r of rateRows(p.rates)) {
    doc.text(r.label, cBand, y)
    doc.text(r.cls != null ? money(r.cls) : '—', cCls, y, { align: 'right' })
    doc.text(r.one != null ? money(r.one) : '—', cOne, y, { align: 'right' })
    doc.setDrawColor(...FAINT); doc.setLineWidth(0.2); doc.line(L, y + 3, R, y + 3)
    y += 9
  }

  // Terms (from the Employment Agreement, clause 4)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...GREY)
  doc.text('HOW YOU ARE PAID', L, y, { charSpace: 0.6 })
  y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK)
  const pct = Math.round((Number(p.superRate) || 0) * 1000) / 10
  const lines = [
    'Rates are per hour of lesson time and are paid for the shifts you work as a casual employee.',
    p.payMethod === 'cash'
      ? 'Pay is processed fortnightly.'
      : 'Pay is processed fortnightly to your nominated bank account, with tax withheld in line with the ATO.',
    `CUBE contributes superannuation on top of these rates at the current Superannuation Guarantee rate${pct ? ` (${pct}%)` : ''}.`,
    'Rates may be reviewed from time to time; any change will be given to you in writing.',
  ]
  for (const t of lines) {
    const wrapped = doc.splitTextToSize(`•  ${t}`, R - L)
    doc.text(wrapped, L, y)
    y += wrapped.length * 5 + 1.5
  }

  return doc.output('datauristring').split('base64,')[1]
}
