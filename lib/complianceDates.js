/*
 * Australian Pty Ltd compliance calendar — BAS, Company Tax, ASIC. (Super is
 * paid with each pay run under Payday Super, so it has no calendar entry.)
 * Single source for the Due Dates page and the Accounting Dashboard.
 * Each item: { category, label, description, due (ISO), icon, color, note?, ato }.
 */

export function daysUntil(dateStr, from = new Date()) {
  const d = new Date(dateStr + 'T00:00:00')
  const t = new Date(from); t.setHours(0, 0, 0, 0)
  return Math.round((d - t) / 86400000)
}

// ── Due dates data ────────────────────────────────────────────────────────────
// Source: ATO lodgment program for small businesses (Pty Ltd)
export const DUE_DATES = [
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

  // Superannuation is no longer a calendar item: from 1 July 2026 (Payday
  // Super) it is paid with each pay run, not quarterly, so there is no
  // separate due date to remind about.

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

