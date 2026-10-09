import { LESSONS_PER_TERM, SUPER_RATE, lessonHoursFromClass, rateForClass } from './teacherCost'
import { isOneToOneClass } from './classFormat'

/*
 * One term's projected finances — revenue from active enrolment prices, tutor
 * cost from the timetable at current pay rates, fixed costs, and the pricing
 * discounts its invoices actually apply. The Forecast page and the accounting
 * dashboard's revenue/profit-by-term chart both use this, so the two agree.
 */

export const TAX_RATE = 0.25   // 25% company tax

/*
 * Every reduction actually applied to a term's invoices: sibling and multi-course
 * discounts, the 10% cash discount, referral rewards, absence credits and manual
 * adjustments. Income here is projected from enrolment prices, so anything an
 * invoice knocks off has to be subtracted or the forecast counts money that will
 * never arrive.
 *
 * Line items are the source of truth. The sibling_discount / multi_course_discount
 * columns duplicate a subset of them and go stale when an invoice is regenerated
 * (live data has invoices whose column says $100 while the line items — which
 * reconcile to invoice.total — say nothing), so reading both would double-count.
 * Anything that is not an enrolment line and carries a negative amount counts,
 * which means new reduction types are picked up without touching this.
 */
export function invoiceReductions(invoices = []) {
  const r = { sibling: 0, multiCourse: 0, cash: 0, referral: 0, creditsOther: 0 }
  for (const inv of invoices) {
    for (const l of inv.line_items || []) {
      if (l.type === 'enrolment') continue
      const amt = -Number(l.amount || 0)          // reductions are stored negative
      if (!amt) continue
      const reason = l.reason || ''
      if (l.type === 'discount' && l.cash) r.cash += amt
      else if (l.type === 'discount' && /sibling/i.test(reason)) r.sibling += amt
      else if (l.type === 'discount' && /multi[- ]?course/i.test(reason)) r.multiCourse += amt
      // Referrals are discounts (revenue forgone); credits are money owed back
      // for absences. They post to different Xero accounts, so count them apart.
      else if (/referral/i.test(reason)) r.referral += amt
      else r.creditsOther += amt
    }
  }
  // The forecast assumes full attendance, so credits and adjustments — absence
  // make-goods, balance transfers, one-off goodwill — are deliberately NOT in
  // the total the projection subtracts. Pricing discounts are; they apply
  // regardless of attendance. creditsOther is kept for display only.
  r.total = r.sibling + r.multiCourse + r.cash + r.referral
  return r
}

// Which students' families pay cash, from the invoices' payment method.
export function cashStudentIdsFrom(invoices = []) {
  return new Set(
    invoices
      .filter(i => i.payment_method === 'cash')
      .flatMap(i => {
        if (i.student_id) return [i.student_id]
        return (i.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id)
      })
      .filter(Boolean)
  )
}

// Per-class figures. `classes` rows carry enrolments(student_id, price, status,
// students(full_name)) and courses(course_price).
export function classMetricsFor(classes = [], { tutors = [], rateMatrix = [], courseModes = {}, cashStudentIds = new Set() } = {}) {
  return classes.map(cls => {
  const activeEnrols = (cls.enrolments || []).filter(e => e.status === 'active')
  const studentCount = activeEnrols.length
  const termFee      = studentCount > 0
    ? activeEnrols.reduce((s, e) => s + Number(e.price || 0), 0) / studentCount
    : 0
  const termIncome   = activeEnrols.reduce((s, e) => s + Number(e.price || 0), 0)
  // How much of this class's income comes from cash-paying families. The Play
  // tab carries the share so a hypothetical scenario applies GST the same way.
  const cashIncome   = activeEnrols.reduce((s, e) => s + (cashStudentIds.has(e.student_id) ? Number(e.price || 0) : 0), 0)
  const cashShare    = termIncome > 0 ? cashIncome / termIncome : 0
  const lessonHrs    = lessonHoursFromClass(cls)
  const lessonCount  = LESSONS_PER_TERM
  const { rate, tutor } = rateForClass(cls, { tutors, rateMatrix, courseModes }) || {}
  const weeklyTeacherFee  = rate ? lessonHrs * rate : 0
  const termlyTeacherFee  = weeklyTeacherFee * lessonCount
  const superApplies      = tutor?.pay_method !== 'cash'
  const superAmount       = superApplies ? termlyTeacherFee * SUPER_RATE : 0
  const totalTeacherCost  = termlyTeacherFee + superAmount
  const termProfit        = termIncome - totalTeacherCost

  // Trials are not income yet — they stay out of termIncome — but a class
  // whose only students are on trial isn't loss-making, it's undecided.
  // trialIncome is what it brings in if they convert (their enrolment price,
  // else the course price, as an invoice would bill it).
  const trialEnrols = (cls.enrolments || []).filter(e => e.status === 'trial')
  const trialIncome = trialEnrols.reduce((s, e) =>
    s + ((e.price != null ? Number(e.price) : Number(cls.courses?.course_price)) || 0), 0)
  const trialOnly   = studentCount === 0 && trialEnrols.length > 0
  const trialNames  = trialEnrols.map(e => (e.students?.full_name || '').split(' ')[0]).filter(Boolean)

  const oneOnOne = isOneToOneClass(cls, courseModes)
  const studentName = oneOnOne && activeEnrols.length === 1
    ? activeEnrols[0].students?.full_name || null
    : null

  return {
    ...cls,
    studentCount, termFee, termIncome, cashIncome, cashShare, lessonHrs, lessonCount,
    teacherRate: rate, teacherName: cls.teacher,
    tutorId: tutor?.id ?? null, tutorName: tutor?.full_name ?? null,
    weeklyTeacherFee, termlyTeacherFee, superApplies, superAmount,
    totalTeacherCost, termProfit,
    is1on1: oneOnOne, studentName,
    trialCount: trialEnrols.length, trialIncome, trialOnly, trialNames,
    studentId: oneOnOne && activeEnrols.length === 1 ? activeEnrols[0].student_id : null,
  }
  })
}

// Term totals from classMetricsFor() rows, the term's fixed costs and invoices.
export function termSummary(classMetrics = [], fixedCosts = [], invoices = []) {
  const grouped  = classMetrics.filter(c => !c.is1on1)
  const oneOnOne = classMetrics.filter(c => c.is1on1)

  const classIncome   = grouped.reduce((s, c) => s + c.termIncome, 0)
  const oneOnOneIncome = oneOnOne.reduce((s, c) => s + c.termIncome, 0)
  const totalIncome   = classIncome + oneOnOneIncome

  // Cash is GST-exempt, bank attracts GST (÷ 1.1). Per-class cash income comes
  // from classMetrics, which uses enrolment prices — the same source as
  // totalIncome — so afterGst can never exceed it.
  const cashEnrolIncome = classMetrics.reduce((s, c) => s + c.cashIncome, 0)
  const bankEnrolIncome = totalIncome - cashEnrolIncome
  const afterGst = cashEnrolIncome + bankEnrolIncome / 1.1

  const classTeacherCost   = grouped.reduce((s, c) => s + c.totalTeacherCost, 0)
  const oneOnOneTeacherCost = oneOnOne.reduce((s, c) => s + c.totalTeacherCost, 0)

  // Fixed costs annualised to term — paid from the bank account.
  const fixedTermly = fixedCosts.reduce((s, fc) => {
    const amt = Number(fc.amount || 0)
    return s + (fc.frequency === 'monthly' ? amt * 3 : amt / 4)
  }, 0)
  const totalExpenses = classTeacherCost + oneOnOneTeacherCost + fixedTermly

  const reductions         = invoiceReductions(invoices)
  const siblingDiscount    = reductions.sibling
  const multiCourseDiscount = reductions.multiCourse
  const cashDiscount       = reductions.cash
  const referralDiscount   = reductions.referral
  const creditsOther       = reductions.creditsOther
  const totalDiscount      = reductions.total

  const classProfit    = classIncome - classTeacherCost
  const oneOnOneProfit = oneOnOneIncome - oneOnOneTeacherCost

  // Hypothetical split: cash income is modelled as untaxed, bank income taxed at
  // the company rate — the same "what is cash potentially worth" framing as the
  // GST treatment above. (Company tax is really payable on profit however it is
  // collected; this is a projection, not a tax position.)
  //
  // Costs are apportioned by each side's share of GROSS income, because a
  // cash-paying student consumes the same teaching as a bank-paying one on the
  // same fee. Splitting them by tutor pay method — as this once did — compares
  // two unrelated facts and makes the cash side look ruinous.
  const totalCosts   = totalExpenses + totalDiscount
  const cashShareOfIncome = totalIncome > 0 ? cashEnrolIncome / totalIncome : 0
  const cashProfit   = cashEnrolIncome - totalCosts * cashShareOfIncome
  const bankProfit   = bankEnrolIncome / 1.1 - totalCosts * (1 - cashShareOfIncome)
  const totalProfit  = cashProfit + bankProfit
  // Only the bank side is taxed, and a loss on it pays no tax.
  const afterTax     = totalProfit - Math.max(0, bankProfit) * TAX_RATE

  return {
    classIncome, oneOnOneIncome, totalIncome, afterGst,
    classTeacherCost, oneOnOneTeacherCost, fixedTermly, totalExpenses,
    siblingDiscount, multiCourseDiscount, cashDiscount, referralDiscount, creditsOther, totalDiscount,
    classProfit, oneOnOneProfit, cashProfit, bankProfit, totalProfit, afterTax,
  }
}

/*
 * Revenue and profit for every term that has active enrolments, oldest first.
 * Profit is termSummary().totalProfit — after GST, before tax — so a term's
 * point matches that term's Forecast. Past terms are costed at TODAY's pay
 * rates and fixed costs (rates aren't kept per term), and count the
 * enrolments still marked active.
 */
export function financeByTerm({ terms = [], classes = [], invoices = [], fixedCosts = [], tutors = [], rateMatrix = [], courseModes = {} }) {
  const classesByTerm = {}
  for (const c of classes) (classesByTerm[c.term_id] ||= []).push(c)
  const invoicesByTerm = {}
  for (const i of invoices) (invoicesByTerm[i.term_id] ||= []).push(i)
  return [...terms]
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    .map(t => {
      const invs = invoicesByTerm[t.id] || []
      const metrics = classMetricsFor(classesByTerm[t.id] || [], {
        tutors, rateMatrix, courseModes, cashStudentIds: cashStudentIdsFrom(invs),
      })
      const s = termSummary(metrics, fixedCosts, invs)
      return { id: t.id, name: t.name || `T${t.term_number} ${t.year}`, revenue: s.totalIncome, profit: s.totalProfit }
    })
    .filter(r => r.revenue > 0)
}
