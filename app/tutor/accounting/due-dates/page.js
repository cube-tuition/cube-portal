'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Accounting Due Dates — /tutor/accounting/due-dates
 *
 * Australian Pty Ltd obligations: BAS, Superannuation, Company Tax Return.
 * Dates are based on ATO standard lodgment program for small businesses.
 * Always confirm with your accountant — extensions may apply.
 */

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((d - TODAY) / (1000 * 60 * 60 * 24))
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Due dates data ────────────────────────────────────────────────────────────
// Source: ATO lodgment program for small businesses (Pty Ltd)
const DUE_DATES = [
  // ── BAS (quarterly) ──
  {
    category:    'BAS',
    label:       'BAS Q1 FY2025–26',
    description: 'Business Activity Statement — Jul–Sep 2025 quarter',
    due:         '2025-10-28',
    icon:        '🧾',
    color:       'blue',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/business-activity-statements-bas',
  },
  {
    category:    'BAS',
    label:       'BAS Q2 FY2025–26',
    description: 'Business Activity Statement — Oct–Dec 2025 quarter',
    due:         '2026-02-28',
    icon:        '🧾',
    color:       'blue',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/business-activity-statements-bas',
  },
  {
    category:    'BAS',
    label:       'BAS Q3 FY2025–26',
    description: 'Business Activity Statement — Jan–Mar 2026 quarter',
    due:         '2026-04-28',
    icon:        '🧾',
    color:       'blue',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/business-activity-statements-bas',
  },
  {
    category:    'BAS',
    label:       'BAS Q4 FY2025–26',
    description: 'Business Activity Statement — Apr–Jun 2026 quarter',
    due:         '2026-07-28',
    icon:        '🧾',
    color:       'blue',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/business-activity-statements-bas',
  },
  {
    category:    'BAS',
    label:       'BAS Q1 FY2026–27',
    description: 'Business Activity Statement — Jul–Sep 2026 quarter',
    due:         '2026-10-28',
    icon:        '🧾',
    color:       'blue',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/business-activity-statements-bas',
  },
  {
    category:    'BAS',
    label:       'BAS Q2 FY2026–27',
    description: 'Business Activity Statement — Oct–Dec 2026 quarter',
    due:         '2027-02-28',
    icon:        '🧾',
    color:       'blue',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/business-activity-statements-bas',
  },

  // ── Superannuation (quarterly) ──
  {
    category:    'Super',
    label:       'Super Q1 FY2025–26',
    description: 'Superannuation Guarantee — Jul–Sep 2025 quarter',
    due:         '2025-10-28',
    icon:        '🏦',
    color:       'green',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/when-to-pay-super',
  },
  {
    category:    'Super',
    label:       'Super Q2 FY2025–26',
    description: 'Superannuation Guarantee — Oct–Dec 2025 quarter',
    due:         '2026-01-28',
    icon:        '🏦',
    color:       'green',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/when-to-pay-super',
  },
  {
    category:    'Super',
    label:       'Super Q3 FY2025–26',
    description: 'Superannuation Guarantee — Jan–Mar 2026 quarter',
    due:         '2026-04-28',
    icon:        '🏦',
    color:       'green',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/when-to-pay-super',
  },
  {
    category:    'Super',
    label:       'Super Q4 FY2025–26',
    description: 'Superannuation Guarantee — Apr–Jun 2026 quarter',
    due:         '2026-07-28',
    icon:        '🏦',
    color:       'green',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/when-to-pay-super',
  },
  {
    category:    'Super',
    label:       'Super Q1 FY2026–27',
    description: 'Superannuation Guarantee — Jul–Sep 2026 quarter',
    due:         '2026-10-28',
    icon:        '🏦',
    color:       'green',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/when-to-pay-super',
  },
  {
    category:    'Super',
    label:       'Super Q2 FY2026–27',
    description: 'Superannuation Guarantee — Oct–Dec 2026 quarter',
    due:         '2027-01-28',
    icon:        '🏦',
    color:       'green',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/when-to-pay-super',
  },

  // ── Company Tax Return ──
  {
    category:    'Tax Return',
    label:       'Company Tax Return FY2024–25',
    description: 'Annual company tax return — self-lodging deadline',
    due:         '2025-10-31',
    icon:        '🏢',
    color:       'purple',
    note:        'Via tax agent: typically 15 May 2026',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/company-tax-return',
  },
  {
    category:    'Tax Return',
    label:       'Company Tax Return FY2025–26',
    description: 'Annual company tax return — self-lodging deadline',
    due:         '2026-10-31',
    icon:        '🏢',
    color:       'purple',
    note:        'Via tax agent: typically 15 May 2027',
    ato:         'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/lodgments/company-tax-return',
  },

  // ── ASIC Annual Review ──
  {
    category:    'ASIC',
    label:       'ASIC Annual Review Fee',
    description: 'Annual company review fee — due on your company\'s review date',
    due:         '2026-10-01', // placeholder — varies by company registration date
    icon:        '🏛️',
    color:       'orange',
    note:        'Date varies — check your company\'s ASIC review date',
    ato:         'https://www.asic.gov.au/for-business/your-business/annual-review/',
  },
]

const COLOR_MAP = {
  blue:   { bg: 'bg-[#EEF3FF]', text: 'text-[#325099]', dot: 'bg-[#325099]', badge: 'bg-[#DEE7FF] text-[#325099]' },
  green:  { bg: 'bg-[#ECFDF5]', text: 'text-[#065F46]', dot: 'bg-[#10b981]', badge: 'bg-[#D1FAE5] text-[#065F46]' },
  purple: { bg: 'bg-[#F5F3FF]', text: 'text-[#5B21B6]', dot: 'bg-[#7C3AED]', badge: 'bg-[#EDE9FE] text-[#5B21B6]' },
  orange: { bg: 'bg-[#FFF7ED]', text: 'text-[#92400E]', dot: 'bg-[#F59E0B]', badge: 'bg-[#FEF3C7] text-[#92400E]' },
}

function urgencyStyle(days) {
  if (days < 0)   return { label: 'Overdue',       cls: 'bg-red-100 text-red-700 font-bold' }
  if (days === 0) return { label: 'Due today',      cls: 'bg-red-100 text-red-700 font-bold' }
  if (days <= 14) return { label: `${days}d`,       cls: 'bg-[#FEE2E2] text-red-700 font-bold' }
  if (days <= 30) return { label: `${days}d`,       cls: 'bg-[#FEF3C7] text-[#92400E] font-semibold' }
  if (days <= 60) return { label: `${days}d`,       cls: 'bg-[#EEF3FF] text-[#325099] font-semibold' }
  return               { label: `${days}d`,         cls: 'bg-[#F8FAFF] text-[#325099]/60 font-medium' }
}

const CATEGORIES = ['All', 'BAS', 'Super', 'Tax Return', 'ASIC']

export default function DueDatesPage() {
  const router  = useRouter()
  const [profile,  setProfile]  = useState(null)
  const [filter,   setFilter]   = useState('All')
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(profile)
    })
  }, [router])

  const enriched = DUE_DATES.map(d => ({ ...d, days: daysUntil(d.due) }))
    .sort((a, b) => a.days - b.days)

  const visible = enriched
    .filter(d => filter === 'All' || d.category === filter)
    .filter(d => showPast || d.days >= 0)

  const upcoming = enriched.filter(d => d.days >= 0).slice(0, 3)

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-4xl mx-auto px-6 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/tutor/payroll" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Accounting</Link>
        </div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#062E63]">Due Dates</h1>
          <p className="text-sm text-[#325099]/60 mt-1">Key ATO & ASIC obligations for your company. Confirm dates with your accountant — extensions may apply.</p>
        </div>

        {/* Next up */}
        {upcoming.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#325099]/50 mb-3">Coming up</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {upcoming.map((d, i) => {
                const c   = COLOR_MAP[d.color]
                const urg = urgencyStyle(d.days)
                return (
                  <div key={i} className={`rounded-2xl border border-[#DEE7FF] bg-white p-4 ${i === 0 ? 'ring-2 ring-[#325099]/20' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${c.badge}`}>{d.category}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${urg.cls}`}>{urg.label}</span>
                    </div>
                    <p className="text-sm font-bold text-[#062E63] leading-tight mb-1">{d.label}</p>
                    <p className="text-xs text-[#325099]/60">{fmtDate(d.due)}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1 bg-white border border-[#DEE7FF] rounded-xl p-1 w-fit">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  filter === cat ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#062E63]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowPast(p => !p)}
            className="text-xs font-semibold text-[#325099]/50 hover:text-[#325099] transition"
          >
            {showPast ? 'Hide past' : 'Show past'}
          </button>
        </div>

        {/* Due dates list */}
        <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
          {visible.length === 0 ? (
            <div className="text-center py-12 text-[#325099]/40 text-sm">No dates to show.</div>
          ) : (
            <div className="divide-y divide-[#DEE7FF]">
              {visible.map((d, i) => {
                const c   = COLOR_MAP[d.color]
                const urg = urgencyStyle(d.days)
                const past = d.days < 0
                return (
                  <div key={i} className={`flex items-center gap-4 px-5 py-4 ${past ? 'opacity-50' : ''}`}>
                    {/* colour dot */}
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${past ? 'bg-[#325099]/20' : c.dot}`} />
                    {/* icon + text */}
                    <div className="text-xl shrink-0">{d.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#062E63]">{d.label}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${c.badge}`}>{d.category}</span>
                      </div>
                      <p className="text-xs text-[#325099]/60 mt-0.5">{d.description}</p>
                      {d.note && <p className="text-[11px] text-[#F59E0B] mt-0.5">ℹ {d.note}</p>}
                    </div>
                    {/* date + urgency */}
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-[#2A2035]">{fmtDate(d.due)}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full mt-1 inline-block ${past ? 'bg-[#F8FAFF] text-[#325099]/40' : urg.cls}`}>
                        {past ? 'Past' : urg.label}
                      </span>
                    </div>
                    {/* ATO link */}
                    {d.ato && (
                      <a
                        href={d.ato}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="shrink-0 text-[#325099]/30 hover:text-[#325099] transition text-xs"
                        title="ATO guidance"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-[11px] text-[#325099]/40 mt-4 text-center">
          Dates based on ATO standard lodgment program for small Pty Ltd companies. Always confirm with your accountant.
        </p>

      </div>
    </div>
  )
}
