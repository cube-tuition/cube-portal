/*
 * Every destination in the tutor/director portal, in one place — consumed by
 * the top bar (components/TutorNav.js), the director sidebar
 * (components/DirectorSidebar.js) and the phone menu sheet, so a new page is
 * added here once and reaches all three.
 */
import { SUBJECTS } from './resourceSubjects'

export const BASE_LINKS = [
  { label: 'Home',    href: '/tutor',         icon: '🏠' },
  { label: 'Info',    href: '/tutor/hub',     icon: '📌' },
  { label: 'Classes', href: '/tutor/classes', icon: '🏫' },
]

/*
 * One row per subject hub, built from the hub config rather than typed out
 * twice here: a subject added to lib/resourceSubjects reaches both dropdowns
 * (and its own pages) without a nav list to remember.
 */
export const subjectLinks = (suffix = '') => Object.entries(SUBJECTS).map(([slug, s]) => ({
  label: s.label, href: `/tutor/resources/${slug}${suffix}`, icon: s.icon,
}))

// Tutors get Materials only — each subject goes straight to its Materials
// page (read-only there: no builder, view-only booklet info). The rest of
// Resources (tests, syllabus, question bank) is directors' territory.
export const TUTOR_GROUPS = [
  { label: 'Materials', links: subjectLinks('/materials') },
]
export const TUTOR_LINKS = [
  { label: 'Curriculum',  href: '/tutor/booklets',     icon: '📚' },
  { label: 'My pay',      href: '/tutor/pay',          icon: '💰' },
  { label: 'Availability', href: '/tutor/availability', icon: '📅' },
]

export const ADMIN_FLAT_LINKS = [
  { label: 'Database', href: '/tutor/database', icon: '🗄️' },
]
export const RESOURCES_GROUP = { label: 'Resources', links: subjectLinks() }
export const ADMIN_GROUPS = [
  {
    label: 'Admin',
    links: [
      { label: 'Availabilities', href: '/tutor/admin/availabilities', icon: '📅' },
      { label: 'Drop-ins',      href: '/tutor/dropin',               icon: '☕' },
      { label: 'Emails',        href: '/tutor/emails',               icon: '✉️'  },
      { label: 'Forms',         href: '/tutor/admin/forms',         icon: '📝' },
      { label: 'Marketing',     href: '/tutor/admin/marketing',     icon: '📣' },
      // Portal analytics, Trials and Flags all live under Monitoring now — the
      // hub links to all three, so they are not repeated here.
      { label: 'Monitoring',    href: '/tutor/admin/monitoring',     icon: '📶' },
      { label: 'Reports',       href: '/tutor/reports',              icon: '📊' },
      { label: 'Timetable',     href: '/tutor/admin/timetable',      icon: '🗓️' },
      // desktopOnly: the term-transition wizard is a sit-down job; the phone menu skips it.
      { label: 'Transition',    href: '/tutor/transition',           icon: '🔄', desktopOnly: true },
      { label: 'Operations',    href: '/tutor/admin/work',           icon: '🧭' },
    ],
  },
  {
    label: 'Accounting',
    links: [
      { label: 'Dashboard',  href: '/tutor/accounting',            icon: '🧮' },
      { label: 'Invoices',   href: '/tutor/accounting/invoices',   icon: '🧾' },
      { label: 'Forecast',   href: '/tutor/accounting/forecast',   icon: '📊' },
      { label: 'Cash Log',   href: '/tutor/accounting/cash-log',   icon: '💵' },
      { label: 'Payroll',    href: '/tutor/payroll',               icon: '💳' },
    ],
  },
]
