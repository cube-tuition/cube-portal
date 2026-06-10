'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import TutorNav from '@/components/TutorNav'
import { getAuthProfile } from '@/lib/getProfile'
import { getCurrentTerm } from '@/lib/terms'
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const TAX_RATE   = 0.25   // 25% company tax
const SUPER_RATE = 0.12   // 12% superannuation
const LESSONS_PER_TERM = 10

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTimeToMins(t) {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}
function lessonHoursFromClass(cls) {
  const diff = parseTimeToMins(cls.end_time) - parseTimeToMins(cls.start_time)
  return Math.max(0, diff / 60)
}
function yearBandFromClassName(name) {
  if (!name) return null
  const m = name.match(/Y(\d+)/i)
  if (!m) return null
  const y = parseInt(m[1])
  if (y <= 6)  return '1-6'
  if (y <= 8)  return '7-8'
  if (y <= 10) return '9-10'
  return '11-12'
}
function is1on1(cls) {
  return /\b1:1\b|1-on-1|one.on.one/i.test(cls.class_name)
}
function sortByYear(rows) {
  return [...rows].sort((a, b) => {
    const ya = parseInt((a.class_name || '').match(/Y(\d+)/i)?.[1] || '99')
    const yb = parseInt((b.class_name || '').match(/Y(\d+)/i)?.[1] || '99')
    if (ya !== yb) return ya - yb
    return (a.class_name || '').localeCompare(b.class_name || '')
  })
}
function fmt(n) { return `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtN(n) { return Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// ── Waterfall chart ───────────────────────────────────────────────────────────
function WaterfallChart({ s }) {
  const gst      = s.totalIncome - s.afterGst
  const discount = s.totalDiscount ?? 0
  const expenses = s.totalExpenses
  const profit   = s.totalProfit

  const steps = [
    { name: 'Gross Income',    offset: 0,                                    value: s.totalIncome, type: 'positive' },
    { name: 'Less GST',        offset: s.afterGst,                           value: gst,           type: 'negative' },
    { name: 'Less Discounts',  offset: s.afterGst - discount,                value: discount,      type: 'negative' },
    { name: 'Less Expenses',   offset: Math.max(0, s.afterGst - discount - expenses), value: expenses, type: 'negative' },
    { name: 'Net Profit',      offset: 0,                                    value: Math.abs(profit), type: profit >= 0 ? 'total-pos' : 'total-neg' },
  ]

  const colourOf = t => t === 'positive' ? '#325099' : t === 'negative' ? '#EF4444' : t === 'total-pos' ? '#10B981' : '#EF4444'

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const step = steps.find(s => s.name === label)
    if (!step) return null
    return (
      <div className="bg-white border border-[#DEE7FF] rounded-xl px-3 py-2 shadow text-xs">
        <p className="font-semibold text-[#062E63] mb-1">{label}</p>
        <p className="text-[#325099]">{step.type === 'negative' ? '−' : '+'}{fmt(step.value)}</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={steps} margin={{ top: 16, right: 16, left: 10, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#EEF4FF" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#325099' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F0F4FF' }} />
        {/* Transparent spacer — lifts the coloured bar to the right position */}
        <Bar dataKey="offset" stackId="wf" fill="transparent" isAnimationActive={false} />
        {/* Coloured value bar */}
        <Bar dataKey="value" stackId="wf" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {steps.map((s, i) => <Cell key={i} fill={colourOf(s.type)} />)}
          <LabelList dataKey="value" position="top" formatter={v => `$${(v/1000).toFixed(1)}k`} style={{ fontSize: 10, fill: '#062E63', fontWeight: 600 }} />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Class profit bar chart ─────────────────────────────────────────────────────
function ClassProfitChart({ rows }) {
  const sorted = [...rows]
    .filter(c => c.termIncome > 0 || c.termProfit !== 0)
    .sort((a, b) => b.termProfit - a.termProfit)
    .map(c => ({
      name: c.studentName ? `${c.class_name} · ${c.studentName}` : c.class_name,
      profit: Math.round(c.termProfit),
      income: Math.round(c.termIncome),
    }))

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-white border border-[#DEE7FF] rounded-xl px-3 py-2 shadow text-xs space-y-0.5">
        <p className="font-semibold text-[#062E63] mb-1">{label}</p>
        <p className="text-[#325099]">Income: {fmt(payload[0]?.payload?.income)}</p>
        <p className={payload[0]?.value >= 0 ? 'text-emerald-600' : 'text-red-500'}>Profit: {fmt(payload[0]?.value)}</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 28)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 60, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="#EEF4FF" />
        <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(1)}k`} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#325099' }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F0F4FF' }} />
        <Bar dataKey="profit" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {sorted.map((c, i) => <Cell key={i} fill={c.profit >= 0 ? '#10B981' : '#EF4444'} />)}
          <LabelList dataKey="profit" position="right" formatter={v => `$${(v/1000).toFixed(1)}k`} style={{ fontSize: 10, fill: '#062E63', fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color = '#062E63' }) {
  return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl px-5 py-4">
      <p className="text-[10px] font-semibold text-[#325099]/50 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[#325099]/50 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ForecastPage() {
  const router = useRouter()
  const [profile,  setProfile]  = useState(null)
  const [tab,      setTab]      = useState('live')   // 'live' | 'costs' | 'play' | 'cashlog'
  const [terms,    setTerms]    = useState([])
  const [termId,   setTermId]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    getAuthProfile().then(({ profile: p, role }) => {
      if (!p || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(p)
    })
  }, [router])

  // Live data
  const [classes,    setClasses]    = useState([])
  const [tutors,     setTutors]     = useState([])
  const [rateMatrix, setRateMatrix] = useState([])
  const [fixedCosts, setFixedCosts] = useState([])
  const [invoices,   setInvoices]   = useState([])

  // Fixed costs editing
  const [costDraft,    setCostDraft]    = useState({ name: '', amount: '', frequency: 'yearly' })
  const [costSaving,   setCostSaving]   = useState(false)
  const [editingCost,  setEditingCost]  = useState(null) // cost id being edited

  // Play-around state (initialised from live data)
  const [playClasses,    setPlayClasses]    = useState([])
  const [playFixedCosts, setPlayFixedCosts] = useState([])
  const [playInit,       setPlayInit]       = useState(false)

  // Cash log state
  const [cashLog,          setCashLog]          = useState([])
  const [cashLogLoading,   setCashLogLoading]   = useState(false)
  const [clDateFrom,       setClDateFrom]       = useState('')
  const [clDateTo,         setClDateTo]         = useState('')
  const [clShowAll,        setClShowAll]        = useState(false)
  const [addEntryModal,    setAddEntryModal]     = useState(false)
  const [entryForm,        setEntryForm]         = useState({ date: '', direction: 'inflow', type: 'invoice', description: '', amount: '' })
  const [entrySaving,      setEntrySaving]       = useState(false)
  const [wagesModal,       setWagesModal]        = useState(false)
  const [wagesWeekFrom,    setWagesWeekFrom]     = useState('1')
  const [wagesWeekTo,      setWagesWeekTo]       = useState('2')
  const [wagesPulling,     setWagesPulling]      = useState(false)
  const [wagesPreview,     setWagesPreview]      = useState([])
  const [wagesPreviewLoading, setWagesPreviewLoading] = useState(false)

  // ── Load terms ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('terms').select('id, name, year, term_number, start_date, end_date')
      .order('year', { ascending: false })
      .order('term_number', { ascending: false })
      .then(({ data }) => {
        setTerms(data || [])
        const current = getCurrentTerm(data || [])
        if (current) setTermId(current.id)
        else if (data?.length) setTermId(data[0].id)
      })
  }, [])

  // ── Load supporting data (tutors, rate matrix, fixed costs) ─────────────────
  useEffect(() => {
    supabase.from('tutors').select('id, full_name, pay_method').order('full_name')
      .then(({ data }) => setTutors(data || []))
    supabase.from('current_tutor_rates').select('tutor_id, year_band, mode, hourly_rate')
      .then(({ data }) => setRateMatrix(data || []))
    supabase.from('fixed_costs').select('*').order('frequency').order('name')
      .then(({ data }) => setFixedCosts(data || []))
  }, [])

  // ── Load term-specific data ──────────────────────────────────────────────────
  const loadTerm = useCallback(async () => {
    if (!termId) return
    setLoading(true); setError(null)
    try {
      const [{ data: cls }, { data: inv }] = await Promise.all([
        supabase.from('classes')
          .select(`id, class_name, teacher, start_time, end_time,
            enrolments!inner(id, student_id, price, status, students(full_name)),
            lessons(id, is_makeup)`)
          .eq('term_id', termId),
        supabase.from('invoices')
          .select('sibling_discount, multi_course_discount, total, payment_method, student_id, line_items')
          .eq('term_id', termId)
          .not('status', 'eq', 'voided'),
      ])
      setClasses(cls || [])
      setInvoices(inv || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [termId])

  useEffect(() => { loadTerm() }, [loadTerm])

  // ── Rate lookup helper ───────────────────────────────────────────────────────
  const getRateForClass = useCallback((cls) => {
    const firstName = cls.teacher?.split(' ')[0]?.toLowerCase()
    if (!firstName) return null
    const tutor = tutors.find(t => t.full_name.toLowerCase().startsWith(firstName))
    if (!tutor) return null
    const band = yearBandFromClassName(cls.class_name)
    const mode = is1on1(cls) ? 'tutor' : 'class'
    const row  = rateMatrix.find(r => r.tutor_id === tutor.id && r.year_band === band && r.mode === mode)
    return { rate: row ? Number(row.hourly_rate) : null, tutor }
  }, [tutors, rateMatrix])

  // ── Compute class-level metrics ──────────────────────────────────────────────
  const classMetrics = useMemo(() => {
    return classes.map(cls => {
      const activeEnrols = (cls.enrolments || []).filter(e => e.status === 'active')
      const studentCount = activeEnrols.length
      const termFee      = studentCount > 0
        ? activeEnrols.reduce((s, e) => s + Number(e.price || 0), 0) / studentCount
        : 0
      const termIncome   = activeEnrols.reduce((s, e) => s + Number(e.price || 0), 0)
      const lessonHrs    = lessonHoursFromClass(cls)
      const lessonCount  = LESSONS_PER_TERM
      const { rate, tutor } = getRateForClass(cls) || {}
      const weeklyTeacherFee  = rate ? lessonHrs * rate : 0
      const termlyTeacherFee  = weeklyTeacherFee * lessonCount
      const superApplies      = tutor?.pay_method !== 'cash'
      const superAmount       = superApplies ? termlyTeacherFee * SUPER_RATE : 0
      const totalTeacherCost  = termlyTeacherFee + superAmount
      const termProfit        = termIncome - totalTeacherCost

      const oneOnOne = is1on1(cls)
      const studentName = oneOnOne && activeEnrols.length === 1
        ? activeEnrols[0].students?.full_name || null
        : null

      return {
        ...cls,
        studentCount, termFee, termIncome, lessonHrs, lessonCount,
        teacherRate: rate, teacherName: cls.teacher,
        weeklyTeacherFee, termlyTeacherFee, superApplies, superAmount,
        totalTeacherCost, termProfit,
        is1on1: oneOnOne, studentName,
      }
    })
  }, [classes, getRateForClass])

  // ── Compute summary totals ───────────────────────────────────────────────────
  const summary = useMemo(() => {
    const grouped  = classMetrics.filter(c => !c.is1on1)
    const oneOnOne = classMetrics.filter(c => c.is1on1)

    const classIncome   = grouped.reduce((s, c) => s + c.termIncome, 0)
    const oneOnOneIncome = oneOnOne.reduce((s, c) => s + c.termIncome, 0)
    const totalIncome   = classIncome + oneOnOneIncome

    // Identify cash-paying student IDs from invoice payment_method.
    // Cash invoices are GST-exempt; bank invoices attract GST (÷1.1).
    // Use enrolment prices (same source as totalIncome) to ensure afterGst ≤ totalIncome.
    const cashStudentIds = new Set(
      invoices
        .filter(i => i.payment_method === 'cash')
        .flatMap(i => {
          if (i.student_id) return [i.student_id]
          return (i.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id)
        })
        .filter(Boolean)
    )
    let cashEnrolIncome = 0, bankEnrolIncome = 0
    for (const cls of classMetrics) {
      for (const e of (cls.enrolments || []).filter(e => e.status === 'active')) {
        if (cashStudentIds.has(e.student_id)) cashEnrolIncome += Number(e.price || 0)
        else bankEnrolIncome += Number(e.price || 0)
      }
    }
    const afterGst = cashEnrolIncome + bankEnrolIncome / 1.1

    const classTeacherCost   = grouped.reduce((s, c) => s + c.totalTeacherCost, 0)
    const oneOnOneTeacherCost = oneOnOne.reduce((s, c) => s + c.totalTeacherCost, 0)

    // Fixed costs annualised to term
    const fixedTermly = fixedCosts.reduce((s, fc) => {
      const amt = Number(fc.amount || 0)
      return s + (fc.frequency === 'monthly' ? amt * 3 : amt / 4)
    }, 0)
    const totalExpenses = classTeacherCost + oneOnOneTeacherCost + fixedTermly

    const siblingDiscount    = invoices.reduce((s, i) => s + Number(i.sibling_discount || 0), 0)
    const multiCourseDiscount = invoices.reduce((s, i) => s + Number(i.multi_course_discount || 0), 0)
    const totalDiscount      = siblingDiscount + multiCourseDiscount

    const classProfit    = classIncome - classTeacherCost
    const oneOnOneProfit = oneOnOneIncome - oneOnOneTeacherCost
    const totalProfit    = afterGst - totalExpenses - totalDiscount
    // Cash income is tax-exempt — only tax the bank-derived profit
    const bankAfterGst      = bankEnrolIncome / 1.1
    const taxableProfit     = bankAfterGst - totalExpenses - totalDiscount
    const afterTax          = cashEnrolIncome + taxableProfit * (1 - TAX_RATE)

    return {
      classIncome, oneOnOneIncome, totalIncome, afterGst,
      classTeacherCost, oneOnOneTeacherCost, fixedTermly, totalExpenses,
      siblingDiscount, multiCourseDiscount, totalDiscount,
      classProfit, oneOnOneProfit, totalProfit, afterTax,
    }
  }, [classMetrics, fixedCosts, invoices])

  // ── Initialise play-around — only when Play tab opens, so all data is loaded ──
  useEffect(() => {
    if (tab === 'play' && !playInit && classMetrics.length > 0 && tutors.length > 0) {
      setPlayClasses(classMetrics.map(c => ({
        id: c.id, class_name: c.class_name, teacher: c.teacher,
        studentCount: c.studentCount, termFee: c.termFee,
        lessonHrs: c.lessonHrs, lessonCount: c.lessonCount,
        teacherRate: c.teacherRate || 0, superApplies: c.superApplies,
        is1on1: c.is1on1, studentName: c.studentName,
      })))
      setPlayFixedCosts(fixedCosts.map(fc => ({ ...fc })))
      setPlayInit(true)
    }
  }, [tab, classMetrics, fixedCosts, tutors, playInit])

  // ── Play-around metrics ──────────────────────────────────────────────────────
  const playMetrics = useMemo(() => {
    return playClasses.map(c => {
      const termIncome       = c.studentCount * c.termFee
      const weeklyTeacherFee = c.lessonHrs * c.teacherRate
      const termlyTeacherFee = weeklyTeacherFee * c.lessonCount
      const superAmount      = c.superApplies ? termlyTeacherFee * SUPER_RATE : 0
      const totalTeacherCost = termlyTeacherFee + superAmount
      const termProfit       = termIncome - totalTeacherCost
      return { ...c, termIncome, weeklyTeacherFee, termlyTeacherFee, superAmount, totalTeacherCost, termProfit }
    })
  }, [playClasses])

  const playSummary = useMemo(() => {
    const grouped   = playMetrics.filter(c => !c.is1on1)
    const oneOnOne  = playMetrics.filter(c => c.is1on1)
    const classIncome    = grouped.reduce((s, c) => s + c.termIncome, 0)
    const oneOnOneIncome = oneOnOne.reduce((s, c) => s + c.termIncome, 0)
    const totalIncome    = classIncome + oneOnOneIncome
    const afterGst       = totalIncome / 1.1
    const classTeacherCost    = grouped.reduce((s, c) => s + c.totalTeacherCost, 0)
    const oneOnOneTeacherCost = oneOnOne.reduce((s, c) => s + c.totalTeacherCost, 0)
    const fixedTermly    = playFixedCosts.reduce((s, fc) => {
      const amt = Number(fc.amount || 0)
      return s + (fc.frequency === 'monthly' ? amt * 3 : amt / 4)
    }, 0)
    const totalExpenses      = classTeacherCost + oneOnOneTeacherCost + fixedTermly
    // Carry actual discounts from invoices (same as live)
    const siblingDiscount    = invoices.reduce((s, i) => s + Number(i.sibling_discount || 0), 0)
    const multiCourseDiscount= invoices.reduce((s, i) => s + Number(i.multi_course_discount || 0), 0)
    const totalDiscount      = siblingDiscount + multiCourseDiscount
    const totalProfit        = afterGst - totalExpenses - totalDiscount
    // Match live tax formula: no cash distinction in play, so taxableProfit = afterGst - expenses - discounts
    const afterTax           = totalProfit * (1 - TAX_RATE)
    return {
      classIncome, oneOnOneIncome, totalIncome, afterGst,
      classTeacherCost, oneOnOneTeacherCost, fixedTermly, totalExpenses,
      siblingDiscount, multiCourseDiscount, totalDiscount,
      totalProfit, afterTax,
    }
  }, [playMetrics, playFixedCosts, invoices])

  // ── Fixed cost handlers ──────────────────────────────────────────────────────
  const handleAddCost = async () => {
    if (!costDraft.name.trim() || !costDraft.amount) return
    setCostSaving(true)
    const { data, error: err } = await supabase.from('fixed_costs')
      .insert({ name: costDraft.name.trim(), amount: Number(costDraft.amount), frequency: costDraft.frequency })
      .select().single()
    setCostSaving(false)
    if (err) { setError(err.message); return }
    setFixedCosts(prev => [...prev, data])
    setCostDraft({ name: '', amount: '', frequency: 'yearly' })
  }
  const handleDeleteCost = async (id) => {
    await supabase.from('fixed_costs').delete().eq('id', id)
    setFixedCosts(prev => prev.filter(c => c.id !== id))
  }
  const handleUpdateCost = async (id, field, value) => {
    setFixedCosts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
    await supabase.from('fixed_costs').update({ [field]: field === 'amount' ? Number(value) : value }).eq('id', id)
  }

  // ── Play-around reset ────────────────────────────────────────────────────────
  const handleResetPlay = () => {
    setPlayClasses(classMetrics.map(c => ({
      id: c.id, class_name: c.class_name, teacher: c.teacher,
      studentCount: c.studentCount, termFee: c.termFee,
      lessonHrs: c.lessonHrs, lessonCount: c.lessonCount,
      teacherRate: c.teacherRate || 0, superApplies: c.superApplies,
      is1on1: c.is1on1, studentName: c.studentName,
    })))
    setPlayFixedCosts(fixedCosts.map(fc => ({ ...fc })))
  }

  // ── Tutor pay method handler ─────────────────────────────────────────────────
  const handleTutorPayMethod = async (tutorId, value) => {
    setTutors(prev => prev.map(t => t.id === tutorId ? { ...t, pay_method: value } : t))
    await supabase.from('tutors').update({ pay_method: value }).eq('id', tutorId)
  }

  // ── Cash log helpers ─────────────────────────────────────────────────────────
  const loadCashLog = useCallback(async () => {
    setCashLogLoading(true)
    const term = terms.find(t => t.id === termId)
    let query = supabase.from('cash_log').select('*').order('date', { ascending: true }).order('id', { ascending: true })
    if (!clShowAll) {
      const from = clDateFrom || term?.start_date
      const to   = clDateTo   || term?.end_date
      if (from) query = query.gte('date', from)
      if (to)   query = query.lte('date', to)
    }
    const { data } = await query
    setCashLog(data || [])
    setCashLogLoading(false)
  }, [termId, terms, clDateFrom, clDateTo, clShowAll])

  useEffect(() => { if (tab === 'cashlog') loadCashLog() }, [tab, loadCashLog])

  const handleAddEntry = async () => {
    if (!entryForm.date || !entryForm.amount || !entryForm.type) return
    setEntrySaving(true)
    const term = terms.find(t => t.id === termId)
    const signed = entryForm.direction === 'outflow' ? -Math.abs(Number(entryForm.amount)) : Math.abs(Number(entryForm.amount))
    const { error: err } = await supabase.from('cash_log').insert({
      date: entryForm.date, direction: entryForm.direction, type: entryForm.type,
      description: entryForm.description.trim() || null, amount: signed,
      term_id: term?.id || null,
    })
    setEntrySaving(false)
    if (err) { setError(err.message); return }
    setAddEntryModal(false)
    setEntryForm({ date: '', direction: 'inflow', type: 'invoice', description: '', amount: '' })
    loadCashLog()
  }

  const handleDeleteEntry = async (id) => {
    if (!confirm('Delete this entry?')) return
    await supabase.from('cash_log').delete().eq('id', id)
    setCashLog(prev => prev.filter(e => e.id !== id))
  }

  // Load wages preview when wages modal opens / week range changes
  useEffect(() => {
    if (!wagesModal || !termId) return
    const term = terms.find(t => t.id === termId)
    if (!term?.start_date) return
    setWagesPreviewLoading(true)
    ;(async () => {
      const wFrom = parseInt(wagesWeekFrom) || 1
      const wTo   = parseInt(wagesWeekTo)   || wFrom
      const termStart = new Date(term.start_date + 'T00:00:00')
      const dateFrom  = new Date(termStart); dateFrom.setDate(termStart.getDate() + (wFrom - 1) * 7)
      const dateTo    = new Date(termStart); dateTo.setDate(termStart.getDate() + wTo * 7 - 1)
      const fromIso = dateFrom.toISOString().slice(0, 10)
      const toIso   = dateTo.toISOString().slice(0, 10)

      const cashTutorIds = tutors.filter(t => t.pay_method === 'cash').map(t => t.id)
      if (!cashTutorIds.length) { setWagesPreview([]); setWagesPreviewLoading(false); return }

      const { data: shifts } = await supabase.from('shifts')
        .select('tutor_id, hours, rate_snapshot')
        .in('tutor_id', cashTutorIds)
        .gte('work_date', fromIso)
        .lte('work_date', toIso)

      const totals = {}
      for (const s of shifts || []) {
        const pay = Number(s.hours || 0) * Number(s.rate_snapshot || 0)
        totals[s.tutor_id] = (totals[s.tutor_id] || 0) + pay
      }
      const preview = Object.entries(totals).map(([tid, pay]) => {
        const tutor = tutors.find(t => t.id === tid)
        const firstName = tutor?.full_name?.split(' ')[0] || 'Unknown'
        const termLabel = term.name || `Term ${term.term_number} ${term.year}`
        const weekLabel = wFrom === wTo ? `W${wFrom}` : `W${wFrom}–W${wTo}`
        return { tutor_id: tid, name: firstName, pay: Math.round(pay * 100) / 100,
          description: `${firstName} - ${termLabel} ${weekLabel}` }
      }).filter(p => p.pay > 0)
      setWagesPreview(preview)
      setWagesPreviewLoading(false)
    })()
  }, [wagesModal, wagesWeekFrom, wagesWeekTo, termId, terms, tutors])

  const handlePullWages = async () => {
    if (!wagesPreview.length) return
    setWagesPulling(true)
    const term = terms.find(t => t.id === termId)
    const today = new Date().toISOString().slice(0, 10)
    const rows = wagesPreview.map(p => ({
      date: today, direction: 'outflow', type: 'wages',
      description: p.description, amount: -p.pay, term_id: term?.id || null,
    }))
    const { error: err } = await supabase.from('cash_log').insert(rows)
    setWagesPulling(false)
    if (err) { setError(err.message); return }
    setWagesModal(false)
    loadCashLog()
  }

  // ── Class table (shared between live and play) ───────────────────────────────
  function ClassTable({ rows, editable = false, onChange, hideStudents = false }) {
    const headers = ['Class', ...(!hideStudents ? ['Students'] : []), 'Term Fee', 'Term Income', 'Teacher', 'Rate ($/hr)', 'Hours', 'Super?', 'Weekly Pay', 'Termly Cost (inc. Super)', 'Profit']
    return (
      <div className="overflow-x-auto rounded-2xl border border-[#DEE7FF]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
              {headers.map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F4FF]">
            {rows.map((c, i) => {
              const profit = c.termProfit ?? (c.termIncome - c.totalTeacherCost)
              return (
                <tr key={c.id ?? i} className={`hover:bg-[#F8FAFF] transition ${profit < 0 ? 'bg-red-50' : ''}`}>
                  <td className="px-3 py-2 font-medium text-[#062E63] whitespace-nowrap">
                    {c.class_name}
                    {c.studentName && <span className="ml-1.5 text-[#325099]/50 font-normal">· {c.studentName}</span>}
                  </td>
                  {!hideStudents && <td className="px-3 py-2 text-center">
                    {editable ? (
                      <input type="number" min="0" value={c.studentCount}
                        onChange={e => onChange(i, 'studentCount', parseInt(e.target.value) || 0)}
                        className="w-12 border border-[#DEE7FF] rounded px-1 py-0.5 text-center text-xs" />
                    ) : c.studentCount}
                  </td>}
                  <td className="px-3 py-2">
                    {editable ? (
                      <input type="number" min="0" value={c.termFee}
                        onChange={e => onChange(i, 'termFee', parseFloat(e.target.value) || 0)}
                        className="w-16 border border-[#DEE7FF] rounded px-1 py-0.5 text-xs" />
                    ) : fmt(c.termFee)}
                  </td>
                  <td className="px-3 py-2 font-semibold text-[#062E63]">{fmt(c.termIncome)}</td>
                  <td className="px-3 py-2 text-[#325099]/70">{c.teacher || '—'}</td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <input type="number" min="0" value={c.teacherRate}
                        onChange={e => onChange(i, 'teacherRate', parseFloat(e.target.value) || 0)}
                        className="w-14 border border-[#DEE7FF] rounded px-1 py-0.5 text-xs" />
                    ) : (c.teacherRate ? `$${c.teacherRate}` : <span className="text-[#325099]/30">—</span>)}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <input type="number" min="0" step="0.5" value={c.lessonHrs}
                        onChange={e => onChange(i, 'lessonHrs', parseFloat(e.target.value) || 0)}
                        className="w-12 border border-[#DEE7FF] rounded px-1 py-0.5 text-xs" />
                    ) : c.lessonHrs.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editable ? (
                      <input type="checkbox" checked={c.superApplies}
                        onChange={e => onChange(i, 'superApplies', e.target.checked)}
                        className="accent-[#325099]" />
                    ) : (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.superApplies ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {c.superApplies ? 'Yes' : 'No'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{c.weeklyTeacherFee ? fmt(c.weeklyTeacherFee) : '—'}</td>
                  <td className="px-3 py-2">{c.totalTeacherCost ? fmt(c.totalTeacherCost) : '—'}</td>
                  <td className={`px-3 py-2 font-bold ${profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {fmt(profit)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // ── Summary grid ─────────────────────────────────────────────────────────────
  function SummaryGrid({ s, yearly = false }) {
    const m = yearly ? 4 : 1
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Income */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-bold text-[#325099]/50 uppercase tracking-wider">Total Income</p>
          <div className="space-y-1">
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">Class Income</span><span className="font-semibold">{fmt(s.classIncome * m)}</span></div>
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">1-on-1 Income</span><span className="font-semibold">{fmt(s.oneOnOneIncome * m)}</span></div>
            <div className="flex justify-between text-xs font-bold border-t border-[#DEE7FF] pt-1 mt-1"><span>Total</span><span>{fmt(s.totalIncome * m)}</span></div>
            <div className="flex justify-between text-xs text-emerald-700 font-semibold"><span>After GST</span><span>{fmt(s.afterGst * m)}</span></div>
          </div>
        </div>
        {/* Expenses */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-bold text-[#325099]/50 uppercase tracking-wider">Total Expenses</p>
          <div className="space-y-1">
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">Class Teacher Pay</span><span className="font-semibold">{fmt(s.classTeacherCost * m)}</span></div>
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">1-on-1 Teacher Pay</span><span className="font-semibold">{fmt(s.oneOnOneTeacherCost * m)}</span></div>
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">Fixed Costs</span><span className="font-semibold">{fmt(s.fixedTermly * m)}</span></div>
            <div className="flex justify-between text-xs font-bold border-t border-[#DEE7FF] pt-1 mt-1"><span>Total</span><span>{fmt(s.totalExpenses * m)}</span></div>
          </div>
        </div>
        {/* Discounts (live only) */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-bold text-[#325099]/50 uppercase tracking-wider">Discounts</p>
          <div className="space-y-1">
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">Multi-course</span><span className="font-semibold">{fmt((s.multiCourseDiscount ?? 0) * m)}</span></div>
            <div className="flex justify-between text-xs"><span className="text-[#325099]/70">Sibling</span><span className="font-semibold">{fmt((s.siblingDiscount ?? 0) * m)}</span></div>
            <div className="flex justify-between text-xs font-bold border-t border-[#DEE7FF] pt-1 mt-1"><span>Total</span><span>{fmt((s.totalDiscount ?? 0) * m)}</span></div>
          </div>
        </div>
        {/* Profit */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-bold text-[#325099]/50 uppercase tracking-wider">Profit</p>
          <div className="space-y-1">
            {(() => {
              // Split after-GST income proportionally between class and 1-on-1
              const total     = s.totalIncome || 1
              const classShare   = s.classIncome    / total
              const oneOnOneShare= s.oneOnOneIncome / total
              const classP    = (s.afterGst * classShare    - s.classTeacherCost)    * m
              const oneOnOneP = (s.afterGst * oneOnOneShare - s.oneOnOneTeacherCost) * m
              const fixedCost = (s.fixedTermly ?? 0) * m
              const discount  = (s.totalDiscount  ?? 0) * m
              return (<>
                <div className="flex justify-between text-xs"><span className="text-[#325099]/70">Class (after GST − teacher)</span><span className="font-semibold">{fmt(classP)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#325099]/70">1-on-1 (after GST − teacher)</span><span className="font-semibold">{fmt(oneOnOneP)}</span></div>
                {fixedCost > 0 && <div className="flex justify-between text-xs text-red-500"><span>Fixed Costs</span><span>−{fmt(fixedCost)}</span></div>}
                {discount  > 0 && <div className="flex justify-between text-xs text-red-500"><span>Discounts</span><span>−{fmt(discount)}</span></div>}
                <div className="flex justify-between text-xs font-bold border-t border-[#DEE7FF] pt-1 mt-1"><span>Total Profit</span><span className={s.totalProfit * m >= 0 ? 'text-emerald-700' : 'text-red-600'}>{fmt(s.totalProfit * m)}</span></div>
                <div className="flex justify-between text-xs font-bold"><span className="text-[#325099]/70">After Tax (25%)</span><span className={s.afterTax * m >= 0 ? 'text-emerald-700' : 'text-red-600'}>{fmt(s.afterTax * m)}</span></div>
              </>)
            })()}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Financial Forecast</h1>
            <p className="text-sm text-[#325099]/60 mt-0.5">Live projections based on current enrolments</p>
          </div>
          <select value={termId} onChange={e => setTermId(e.target.value)}
            className="border border-[#DEE7FF] rounded-xl px-4 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30">
            {terms.map(t => <option key={t.id} value={t.id}>{t.name || `Term ${t.term_number} ${t.year}`}</option>)}
          </select>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-[#DEE7FF] rounded-xl p-1 w-fit">
          {[{ id: 'live', label: '📈 Live Forecast' }, { id: 'costs', label: '⚙️ Fixed Costs' }, { id: 'play', label: '🎮 Play Around' }, { id: 'cashlog', label: '💵 Cash Log' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${tab === t.id ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#325099]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* ── LIVE FORECAST TAB ─────────────────────────────────────────────── */}
        {tab === 'live' && (
          <div className="space-y-8">
            {loading ? (
              <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <>
                {/* Term summary */}
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-[#062E63]">Term Forecast</h2>
                  <SummaryGrid s={summary} />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
                    <h3 className="text-xs font-bold text-[#062E63] mb-1">Profit by Class — Group</h3>
                    <p className="text-[11px] text-[#325099]/50 mb-4">Term profit per group class after teacher costs</p>
                    <ClassProfitChart rows={classMetrics.filter(c => !c.is1on1)} />
                  </div>
                  <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
                    <h3 className="text-xs font-bold text-[#062E63] mb-1">Profit by Class — 1-on-1</h3>
                    <p className="text-[11px] text-[#325099]/50 mb-4">Term profit per 1-on-1 session after teacher costs</p>
                    <ClassProfitChart rows={classMetrics.filter(c => c.is1on1)} />
                  </div>
                </div>

                {/* Yearly forecast */}
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-[#062E63]">Yearly Forecast <span className="font-normal text-[#325099]/50">(term × 4)</span></h2>
                  <SummaryGrid s={summary} yearly />
                </div>

                {/* Class table */}
                <div className="space-y-6">
                  <h2 className="text-sm font-bold text-[#062E63]">Class-by-Class Analysis</h2>
                  {classMetrics.length === 0 ? (
                    <div className="bg-white border border-[#DEE7FF] rounded-2xl p-12 text-center text-[#325099]/40 text-sm">No classes found for this term.</div>
                  ) : (
                    <>
                      {classMetrics.filter(c => !c.is1on1).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-[#325099]/60 uppercase tracking-wider">Group Classes</p>
                          <ClassTable rows={sortByYear(classMetrics.filter(c => !c.is1on1))} />
                        </div>
                      )}
                      {classMetrics.filter(c => c.is1on1).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-[#325099]/60 uppercase tracking-wider">1-on-1 Sessions</p>
                          <ClassTable rows={sortByYear(classMetrics.filter(c => c.is1on1))} hideStudents />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Tutor pay method */}
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-[#062E63]">Teacher Payment Method</h2>
                  <p className="text-xs text-[#325099]/60">Bank-paid teachers attract 12% superannuation. Cash-paid teachers do not.</p>
                  <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Teacher</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Pay Method</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Super?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F4FF]">
                        {tutors.map(t => (
                          <tr key={t.id} className="hover:bg-[#F8FAFF]">
                            <td className="px-4 py-2.5 font-medium text-[#062E63]">{t.full_name}</td>
                            <td className="px-4 py-2.5">
                              <select value={t.pay_method || 'bank'} onChange={e => handleTutorPayMethod(t.id, e.target.value)}
                                className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs bg-white focus:outline-none">
                                <option value="bank">Bank</option>
                                <option value="cash">Cash</option>
                              </select>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${t.pay_method !== 'cash' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                {t.pay_method !== 'cash' ? '+12%' : 'None'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── FIXED COSTS TAB ───────────────────────────────────────────────── */}
        {tab === 'costs' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h2 className="text-sm font-bold text-[#062E63]">Fixed Costs</h2>
              <p className="text-xs text-[#325099]/60 mt-0.5">These are factored into every term's forecast. Monthly costs are multiplied × 3 per term; yearly costs are divided ÷ 4.</p>
            </div>

            {/* Add cost form */}
            <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 space-y-4">
              <p className="text-xs font-semibold text-[#062E63]">Add New Cost</p>
              <div className="grid grid-cols-3 gap-3">
                <input placeholder="Name (e.g. Rent)" value={costDraft.name}
                  onChange={e => setCostDraft(d => ({ ...d, name: e.target.value }))}
                  className="col-span-3 md:col-span-1 border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                <input type="number" placeholder="Amount ($)" value={costDraft.amount}
                  onChange={e => setCostDraft(d => ({ ...d, amount: e.target.value }))}
                  className="border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                <select value={costDraft.frequency} onChange={e => setCostDraft(d => ({ ...d, frequency: e.target.value }))}
                  className="border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30">
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <button onClick={handleAddCost} disabled={costSaving || !costDraft.name || !costDraft.amount}
                className="px-4 py-2 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
                {costSaving ? 'Saving…' : '+ Add Cost'}
              </button>
            </div>

            {/* Cost list */}
            {fixedCosts.length === 0 ? (
              <div className="bg-white border border-[#DEE7FF] rounded-2xl p-10 text-center text-[#325099]/40 text-sm">No fixed costs added yet.</div>
            ) : (
              <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Amount</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Frequency</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Per Term</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F4FF]">
                    {fixedCosts.map(fc => {
                      const perTerm = fc.frequency === 'monthly' ? Number(fc.amount) * 3 : Number(fc.amount) / 4
                      return (
                        <tr key={fc.id} className="hover:bg-[#F8FAFF]">
                          <td className="px-4 py-2.5">
                            <input value={fc.name} onChange={e => handleUpdateCost(fc.id, 'name', e.target.value)}
                              className="border border-transparent hover:border-[#DEE7FF] focus:border-[#DEE7FF] rounded px-2 py-0.5 text-sm w-full focus:outline-none" />
                          </td>
                          <td className="px-4 py-2.5">
                            <input type="number" value={fc.amount} onChange={e => handleUpdateCost(fc.id, 'amount', e.target.value)}
                              className="border border-transparent hover:border-[#DEE7FF] focus:border-[#DEE7FF] rounded px-2 py-0.5 text-sm w-24 focus:outline-none" />
                          </td>
                          <td className="px-4 py-2.5">
                            <select value={fc.frequency} onChange={e => handleUpdateCost(fc.id, 'frequency', e.target.value)}
                              className="border border-[#DEE7FF] rounded px-2 py-0.5 text-xs bg-white focus:outline-none">
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </td>
                          <td className="px-4 py-2.5 text-[#325099]/70 text-xs">{fmt(perTerm)}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => handleDeleteCost(fc.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals */}
            {fixedCosts.length > 0 && (
              <div className="flex gap-4 text-sm">
                <div className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3">
                  <span className="text-[#325099]/60 text-xs">Per Term </span>
                  <span className="font-bold text-[#062E63]">{fmt(summary.fixedTermly)}</span>
                </div>
                <div className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3">
                  <span className="text-[#325099]/60 text-xs">Per Year </span>
                  <span className="font-bold text-[#062E63]">{fmt(summary.fixedTermly * 4)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PLAY AROUND TAB ───────────────────────────────────────────────── */}
        {tab === 'play' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#062E63]">Play Around</h2>
                <p className="text-xs text-[#325099]/60 mt-0.5">Edit any value freely — nothing is saved. Reset to reload from live data.</p>
              </div>
              <button type="button" onClick={handleResetPlay}
                className="text-xs px-3 py-1.5 border border-[#DEE7FF] rounded-lg text-[#325099] hover:bg-[#F0F4FF] transition">
                ↺ Reset to live
              </button>
            </div>

            {/* Play summary */}
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-[#062E63]">Term Forecast</h2>
              <SummaryGrid s={playSummary} />
            </div>
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-[#062E63]">Yearly Forecast <span className="font-normal text-[#325099]/50">(term × 4)</span></h2>
              <SummaryGrid s={playSummary} yearly />
            </div>

            {/* Play class table */}
            <div className="space-y-6">
              <h2 className="text-sm font-bold text-[#062E63]">Class-by-Class</h2>
              {playMetrics.filter(c => !c.is1on1).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#325099]/60 uppercase tracking-wider">Group Classes</p>
                  <ClassTable
                    rows={sortByYear(playMetrics.filter(c => !c.is1on1))}
                    editable
                    onChange={(i, field, value) => {
                      const id = sortByYear(playMetrics.filter(x => !x.is1on1))[i]?.id
                      if (id != null) setPlayClasses(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
                    }}
                  />
                </div>
              )}
              {playMetrics.filter(c => c.is1on1).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#325099]/60 uppercase tracking-wider">1-on-1 Sessions</p>
                  <ClassTable
                    rows={sortByYear(playMetrics.filter(c => c.is1on1))}
                    editable
                    hideStudents
                    onChange={(i, field, value) => {
                      const id = sortByYear(playMetrics.filter(x => x.is1on1))[i]?.id
                      if (id != null) setPlayClasses(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
                    }}
                  />
                </div>
              )}
            </div>

            {/* Play fixed costs */}
            <div className="space-y-3 max-w-lg">
              <h2 className="text-sm font-bold text-[#062E63]">Fixed Costs</h2>
              <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Amount</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider">Frequency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F4FF]">
                    {playFixedCosts.map((fc, i) => (
                      <tr key={fc.id ?? i}>
                        <td className="px-4 py-2">{fc.name}</td>
                        <td className="px-4 py-2">
                          <input type="number" value={fc.amount}
                            onChange={e => setPlayFixedCosts(prev => prev.map((c, idx) => idx === i ? { ...c, amount: parseFloat(e.target.value) || 0 } : c))}
                            className="w-24 border border-[#DEE7FF] rounded px-2 py-0.5 text-xs focus:outline-none" />
                        </td>
                        <td className="px-4 py-2">
                          <select value={fc.frequency}
                            onChange={e => setPlayFixedCosts(prev => prev.map((c, idx) => idx === i ? { ...c, frequency: e.target.value } : c))}
                            className="border border-[#DEE7FF] rounded px-2 py-0.5 text-xs bg-white focus:outline-none">
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                    {playFixedCosts.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-[#325099]/40 text-xs">No fixed costs. Add some in the Fixed Costs tab first.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {/* ── CASH LOG TAB ──────────────────────────────────────────────────── */}
        {tab === 'cashlog' && (() => {
          const INFLOW_TYPES  = ['invoice', 'gift', 'withdrawal']
          const OUTFLOW_TYPES = ['wages', 'return']
          const types = entryForm.direction === 'inflow' ? INFLOW_TYPES : OUTFLOW_TYPES

          // Running balance
          let running = 0
          const rows = cashLog.map(e => {
            running += Number(e.amount)
            return { ...e, running }
          })
          const net = running

          return (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-[#062E63]">Cash Log</h2>
                  <p className="text-xs text-[#325099]/60 mt-0.5">Track all cash inflows and outflows</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setWagesModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-[#DEE7FF] text-xs font-semibold text-[#325099] rounded-lg hover:bg-[#F0F4FF] transition">
                    ⚙ Pull Teacher Wages
                  </button>
                  <button onClick={() => { setAddEntryModal(true); setEntryForm({ date: new Date().toISOString().slice(0,10), direction: 'inflow', type: 'invoice', description: '', amount: '' }) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition">
                    + Add Entry
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={clShowAll} onChange={e => setClShowAll(e.target.checked)} className="accent-[#325099] w-3.5 h-3.5" />
                  <span className="text-xs font-semibold text-[#325099]">Show all time</span>
                </label>
                {!clShowAll && (
                  <div className="flex items-center gap-1.5 text-xs text-[#325099]/60">
                    <span className="font-semibold">From</span>
                    <input type="date" value={clDateFrom} onChange={e => setClDateFrom(e.target.value)}
                      className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] focus:outline-none" />
                    <span className="font-semibold">To</span>
                    <input type="date" value={clDateTo} onChange={e => setClDateTo(e.target.value)}
                      className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] focus:outline-none" />
                    {(clDateFrom || clDateTo) && (
                      <button onClick={() => { setClDateFrom(''); setClDateTo('') }}
                        className="text-[#325099]/50 hover:text-[#325099] underline ml-1">Reset</button>
                    )}
                  </div>
                )}
              </div>

              {/* Table */}
              {cashLogLoading ? (
                <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /></div>
              ) : (
                <div className="bg-white border border-[#DEE7FF] rounded-2xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                        {['Date', 'Flow', 'Type', 'Description', 'Amount', 'Balance', ''].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F4FF]">
                      {rows.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-[#325099]/40">No entries yet.</td></tr>
                      )}
                      {rows.map(e => (
                        <tr key={e.id} className="hover:bg-[#F8FAFF] transition">
                          <td className="px-4 py-2.5 text-[#325099]/70 whitespace-nowrap">
                            {new Date(e.date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${e.direction === 'inflow' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {e.direction === 'inflow' ? '↑ In' : '↓ Out'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-[#325099]/70 capitalize">{e.type}</td>
                          <td className="px-4 py-2.5 text-[#062E63] max-w-xs truncate">{e.description || '—'}</td>
                          <td className={`px-4 py-2.5 font-semibold tabular-nums ${Number(e.amount) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {Number(e.amount) >= 0 ? '+' : ''}{fmt(Number(e.amount))}
                          </td>
                          <td className={`px-4 py-2.5 font-semibold tabular-nums ${e.running >= 0 ? 'text-[#062E63]' : 'text-red-600'}`}>
                            {fmt(e.running)}
                          </td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => handleDeleteEntry(e.id)} className="text-red-400 hover:text-red-600 transition">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {rows.length > 0 && (
                      <tfoot>
                        <tr className="bg-[#F8FAFF] border-t-2 border-[#DEE7FF]">
                          <td colSpan={4} className="px-4 py-3 text-xs font-bold text-[#062E63]">Net Total</td>
                          <td colSpan={2} className={`px-4 py-3 text-sm font-bold tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {net >= 0 ? '+' : ''}{fmt(net)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )
        })()}

        {/* Add Entry Modal */}
        {addEntryModal && (() => {
          const types = entryForm.direction === 'inflow' ? ['invoice', 'gift', 'withdrawal'] : ['wages', 'return']
          const canSave = entryForm.date && entryForm.amount && entryForm.type
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#062E63]">Add Cash Entry</h2>
                  <button onClick={() => setAddEntryModal(false)} className="text-[#325099]/50 hover:text-[#325099] text-lg leading-none">✕</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#325099]">Date</label>
                    <input type="date" value={entryForm.date} onChange={e => setEntryForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#325099]">Cash Flow</label>
                    <select value={entryForm.direction} onChange={e => setEntryForm(f => ({ ...f, direction: e.target.value, type: e.target.value === 'inflow' ? 'invoice' : 'wages' }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30">
                      <option value="inflow">↑ Inflow</option>
                      <option value="outflow">↓ Outflow</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">Type</label>
                  <select value={entryForm.type} onChange={e => setEntryForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30">
                    {types.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">Description</label>
                  <input type="text" placeholder="Optional details…" value={entryForm.description} onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">Amount ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={entryForm.amount} onChange={e => setEntryForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                  <p className="text-[10px] text-[#325099]/40">Enter as a positive number — direction is set above</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setAddEntryModal(false)} className="flex-1 px-4 py-2 border border-[#DEE7FF] text-xs font-semibold text-[#325099] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
                  <button onClick={handleAddEntry} disabled={entrySaving || !canSave}
                    className="flex-1 px-4 py-2 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
                    {entrySaving ? 'Saving…' : 'Add Entry'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Pull Teacher Wages Modal */}
        {wagesModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#062E63]">Pull Teacher Wages</h2>
                <button onClick={() => setWagesModal(false)} className="text-[#325099]/50 hover:text-[#325099] text-lg leading-none">✕</button>
              </div>
              <p className="text-xs text-[#325099]/60">Generates cash outflow entries for all cash-paid teachers based on their approved shifts in the selected week range.</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">From Week</label>
                  <select value={wagesWeekFrom} onChange={e => setWagesWeekFrom(e.target.value)}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(w => <option key={w} value={w}>W{w}</option>)}
                  </select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">To Week</label>
                  <select value={wagesWeekTo} onChange={e => setWagesWeekTo(e.target.value)}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(w => <option key={w} value={w}>W{w}</option>)}
                  </select>
                </div>
              </div>

              {/* Preview */}
              <div className="bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl p-3">
                <p className="text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-2">Preview</p>
                {wagesPreviewLoading ? (
                  <div className="flex items-center gap-2 text-xs text-[#325099]/50"><div className="w-3.5 h-3.5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /> Calculating…</div>
                ) : wagesPreview.length === 0 ? (
                  <p className="text-xs text-[#325099]/40">No cash-paid teachers with shifts in this period.</p>
                ) : (
                  <div className="space-y-1.5">
                    {wagesPreview.map(p => (
                      <div key={p.tutor_id} className="flex justify-between text-xs">
                        <span className="text-[#062E63]">{p.description}</span>
                        <span className="font-semibold text-red-600">−{fmt(p.pay)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs font-bold border-t border-[#DEE7FF] pt-1.5 mt-1.5">
                      <span>Total</span>
                      <span className="text-red-600">−{fmt(wagesPreview.reduce((s, p) => s + p.pay, 0))}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => setWagesModal(false)} className="flex-1 px-4 py-2 border border-[#DEE7FF] text-xs font-semibold text-[#325099] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
                <button onClick={handlePullWages} disabled={wagesPulling || wagesPreview.length === 0}
                  className="flex-1 px-4 py-2 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
                  {wagesPulling ? 'Adding…' : `Add ${wagesPreview.length} Entr${wagesPreview.length === 1 ? 'y' : 'ies'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
