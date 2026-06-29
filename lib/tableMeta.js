/**
 * Table/column metadata layer — single source of truth for how operational
 * columns should be displayed, edited and validated in the admin portal.
 *
 * This is a CONFIG layer only. It never changes the database schema and the
 * explorer falls back to its previous behaviour for anything not listed here.
 *
 * Per-column options:
 *   label      friendly display name (header shows this; raw name in tooltip)
 *   type       'text'|'longtext'|'singleSelect'|'linkedRecord'|'email'|'phone'|
 *              'url'|'integer'|'number'|'currency'|'percent'|'date'|'datetime'|
 *              'time'|'boolean'|'json'
 *   options    array of allowed values for singleSelect (legacy values included
 *              so old rows keep rendering/saving)
 *   linked     { refTable, refValue, refLabel } for linkedRecord columns
 *   currency   tagging a column 'currency' is DISPLAY-ONLY: it is still stored
 *              as a plain number and validated as a number. No stored value is
 *              changed — only how the explorer renders/edits it ($ formatting).
 *   required   true → header shows *, quality page flags missing values
 *   readOnly   true → derived/joined/system value, should not be hand-edited
 *   hidden     true → hidden by default on first visit (user can unhide)
 *   help       tooltip text for directors
 *   deprecated note — column kept for backward compatibility, avoid new use
 */

const YEAR_OPTIONS   = ['K','1','2','3','4','5','6','7','8','9','10','11','12']
const GENDER_OPTIONS = ['M','F','Other','Unknown']
const DAY_OPTIONS    = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

export const TABLE_META = {
  students: {
    label: 'Students',
    columns: {
      id:        { label: 'Student ID', readOnly: true, help: 'System UUID — used by enrolments, attendance, invoices.' },
      full_name: { label: 'Full Name', required: true },
      email:     { label: 'Email', type: 'email' },
      phone:     { label: 'Phone', type: 'phone' },
      school:    { label: 'School' },
      year:      { label: 'Year', type: 'singleSelect', options: YEAR_OPTIONS, required: true, help: 'School year level (K–12).' },
      gender:    { label: 'Gender', type: 'singleSelect', options: GENDER_OPTIONS },
      status:    { label: 'Status', type: 'singleSelect', options: ['active','trial','disenrol','quit trial'], required: true },
      is_active: { label: 'Active', type: 'singleSelect', options: ['Active','Inactive'], help: 'Active/Inactive — kept in sync with Status (active/trial = Active; disenrol = Inactive). Picking Inactive disenrols the student.' },
      payment_method: { label: 'Payment', type: 'singleSelect', options: ['bank','cash'], help: 'How this family pays. New invoices inherit it (a family invoice is cash if any member is cash). Set once — it carries across terms.' },
      family_id: { label: 'Family #', type: 'integer', help: 'Shared number linking siblings. Use the Siblings column to manage — avoid editing by hand.' },
    },
  },
  guardians: {
    label: 'Parents / Guardians',
    columns: {
      id:           { label: 'Guardian ID', readOnly: true },
      full_name:    { label: 'Guardian Name', required: true },
      relationship: { label: 'Relationship', type: 'singleSelect', options: ['Mother','Father','Guardian','Grandparent','Other'] },
      email:        { label: 'Email', type: 'email' },
      phone:        { label: 'Phone', type: 'phone' },
      student_id:   { label: 'Student', type: 'linkedRecord', linked: { refTable: 'students', refValue: 'id', refLabel: 'full_name' }, required: true, help: 'Stored as text today — future migration to a proper foreign key.' },
      created_at:   { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  tutors: {
    label: 'Tutors',
    columns: {
      id:         { label: 'Tutor ID', readOnly: true },
      full_name:  { label: 'Full Name', required: true },
      email:      { label: 'Email', type: 'email' },
      phone:      { label: 'Phone', type: 'phone' },
      university: { label: 'University' },
      gender:     { label: 'Gender', type: 'singleSelect', options: GENDER_OPTIONS },
      pay_method: { label: 'Pay Method', type: 'singleSelect', options: ['bank', 'cash'], help: 'bank = included in Xero payroll push; cash = paid in person.' },
      active:     { label: 'Active', type: 'boolean', help: 'Uncheck when a tutor leaves. Inactive tutors are hidden from teacher dropdowns, the availability grid, the timetable and scheduling — but their past classes, lessons and pay are kept.' },
    },
  },
  directors: {
    label: 'Directors',
    columns: {
      id:        { label: 'Director ID', readOnly: true },
      full_name: { label: 'Full Name', required: true },
      email:     { label: 'Email', type: 'email' },
      phone:     { label: 'Phone', type: 'phone' },
      school:    { label: 'School' },
      gender:    { label: 'Gender', type: 'singleSelect', options: GENDER_OPTIONS },
    },
  },
  courses: {
    label: 'Courses',
    columns: {
      id:           { label: 'Course ID', readOnly: true },
      course_name:  { label: 'Course Name', required: true },
      course_code:  { label: 'Code', required: true, help: 'Unique short code.' },
      course_price: { label: 'Price', type: 'currency' },
      delivery_mode:{ label: 'Format', type: 'singleSelect', options: ['Class', '1:1'], required: true, help: '1:1 = one-on-one tuition; Class = group. Drives capacity tracking and 1:1 reporting.' },
      created_at:   { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  classes: {
    label: 'Classes',
    columns: {
      id:          { label: 'Class ID', readOnly: true },
      class_name:  { label: 'Class Name', required: true },
      day_of_week: { label: 'Day', type: 'singleSelect', options: DAY_OPTIONS, required: true },
      start_time:  { label: 'Starts', type: 'time', help: '24h HH:MM' },
      end_time:    { label: 'Ends', type: 'time', help: '24h HH:MM' },
      teacher:     { label: 'Teacher', help: 'Choose from the Tutors list. Stored as the tutor’s name (not a foreign key) so rollups/reports keep working.' },
      room:        { label: 'Room' },
      term_id:     { label: 'Term', type: 'linkedRecord', linked: { refTable: 'terms', refValue: 'id', refLabel: 'name' }, required: true },
      course_id:   { label: 'Course', type: 'linkedRecord', linked: { refTable: 'courses', refValue: 'id', refLabel: 'course_name' }, required: true },
    },
  },
  enrolments: {
    label: 'Enrolments',
    columns: {
      id:               { label: 'Enrolment ID', readOnly: true },
      student_id:       { label: 'Student', type: 'linkedRecord', linked: { refTable: 'students', refValue: 'id', refLabel: 'full_name' }, required: true },
      class_id:         { label: 'Class', type: 'linkedRecord', linked: { refTable: 'classes', refValue: 'id', refLabel: 'class_name' }, required: true },
      price:            { label: 'Price', type: 'currency', help: 'Per-term price. Editing asks for confirmation.' },
      status:           { label: 'Status', type: 'singleSelect', options: ['active','trial','trial complete','disenrol'], required: true },
      next_term_status: { label: 'Next Term', type: 'singleSelect', options: ['pending','confirmed','not_continuing'], help: 'Used by the Term Transition workflow.' },
      trial_start_date: { label: 'Trial Start', type: 'date' },
      ended_at:         { label: 'Ended', type: 'date' },
      end_reason:       { label: 'End Reason' },
      created_at:       { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  terms: {
    label: 'Terms',
    columns: {
      id:          { label: 'Term ID', readOnly: true },
      name:        { label: 'Name', required: true },
      year:        { label: 'Year', type: 'integer', required: true },
      term_number: { label: 'Term #', type: 'singleSelect', options: ['1','2','3','4'], required: true },
      start_date:  { label: 'Starts', type: 'date', required: true },
      end_date:    { label: 'Ends', type: 'date', required: true },
      created_at:  { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  lessons: {
    label: 'Lessons',
    columns: {
      id:                      { label: 'Lesson ID', readOnly: true },
      class_id:                { label: 'Class', type: 'linkedRecord', linked: { refTable: 'classes', refValue: 'id', refLabel: 'class_name' }, required: true },
      lesson_date:             { label: 'Date', type: 'date', required: true },
      start_time:              { label: 'Starts', type: 'time' },
      end_time:                { label: 'Ends', type: 'time' },
      room:                    { label: 'Room' },
      status:                  { label: 'Status', type: 'singleSelect', options: ['scheduled','cancelled'], required: true, help: 'Cancellations are managed via the Cancel Lesson flow, which handles credits.' },
      week:                    { label: 'Week', type: 'integer', readOnly: true, help: 'Computed from lesson date and term.' },
      main_teacher:            { label: 'Main Teacher', readOnly: true, deprecated: 'Rolled up from class.teacher (free text).' },
      scheduled_teacher_id:    { label: 'Scheduled Teacher', type: 'linkedRecord', linked: { refTable: 'tutors', refValue: 'id', refLabel: 'full_name' }, hidden: true, help: 'Edit via the Scheduled Teacher dropdown column.' },
      is_makeup:               { label: 'Makeup?', type: 'boolean', readOnly: true },
      makeup_student_id:       { label: 'Makeup Student', hidden: true, readOnly: true },
      makeup_source_lesson_id: { label: 'Makeup Source', hidden: true, readOnly: true },
      notes:                   { label: 'Notes' },
      notes_general:           { label: 'Notes (General)', hidden: true },
      notes_workbook:          { label: 'Notes (Workbook)', hidden: true },
      notes_homework:          { label: 'Notes (Homework)', hidden: true },
      created_at:              { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  attendance: {
    label: 'Attendance',
    columns: {
      id:              { label: 'ID', readOnly: true },
      student_id:      { label: 'Student', type: 'linkedRecord', linked: { refTable: 'students', refValue: 'id', refLabel: 'full_name' }, required: true },
      class_id:        { label: 'Class', type: 'linkedRecord', linked: { refTable: 'classes', refValue: 'id', refLabel: 'class_name' }, required: true },
      session_date:    { label: 'Date', type: 'date', required: true },
      status:          { label: 'Status', type: 'singleSelect', options: ['present','late','absent','makeup','cancelled'], required: true },
      makeup_class_id: { label: 'Makeup Class', hidden: true },
      trial_feedback:  { label: 'Trial Feedback', hidden: true },
      notes:           { label: 'Notes' },
      created_at:      { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  invoices: {
    label: 'Invoices',
    columns: {
      id:                    { label: 'Invoice ID', readOnly: true },
      invoice_number:        { label: 'Invoice #', readOnly: true },
      term_id:               { label: 'Term', type: 'linkedRecord', linked: { refTable: 'terms', refValue: 'id', refLabel: 'name' }, required: true },
      family_id:             { label: 'Family #', type: 'integer', help: 'Links to students.family_id.' },
      student_id:            { label: 'Student', type: 'linkedRecord', linked: { refTable: 'students', refValue: 'id', refLabel: 'full_name' } },
      subtotal:              { label: 'Subtotal', type: 'currency', readOnly: true, help: 'Generated — edit line items via the invoice tools, not here.' },
      sibling_discount:      { label: 'Sibling Disc.', type: 'currency', readOnly: true },
      multi_course_discount: { label: 'Multi-course Disc.', type: 'currency', readOnly: true },
      total:                 { label: 'Total', type: 'currency', readOnly: true },
      status:                { label: 'Status', type: 'singleSelect', options: ['draft','approved','voided'], required: true },
      payment_status:        { label: 'Payment', type: 'singleSelect', options: ['unpaid','partial','paid','overdue'] },
      delivery_status:       { label: 'Delivery', type: 'singleSelect', options: ['unsent','sent'], required: true },
      payment_method:        { label: 'Pay Method', hidden: true },
      due_date:              { label: 'Due', type: 'date' },
      notes:                 { label: 'Notes' },
      line_items:            { label: 'Line Items', type: 'json', readOnly: true, hidden: true },
      payment_instructions:  { label: 'Payment Instructions', hidden: true },
      reference_code:        { label: 'Reference', hidden: true },
      is_topup:              { label: 'Top-up?', type: 'boolean', hidden: true },
      email_sent:            { label: 'Email Sent?', type: 'boolean', readOnly: true, hidden: true },
      email_sent_at:         { label: 'Email Sent At', readOnly: true, hidden: true },
      generated_at:          { label: 'Generated At', readOnly: true, hidden: true },
      approved_at:           { label: 'Approved At', readOnly: true, hidden: true },
      approved_by:           { label: 'Approved By', readOnly: true, hidden: true },
      pdf_path:              { label: 'PDF Path', readOnly: true, hidden: true },
      xero_invoice_id:       { label: 'Xero Invoice ID', readOnly: true, hidden: true },
      xero_contact_id:       { label: 'Xero Contact ID', readOnly: true, hidden: true },
      xero_invoice_number:   { label: 'Xero Invoice #', readOnly: true, hidden: true },
      xero_status:           { label: 'Xero Status', readOnly: true, hidden: true },
      xero_pushed_at:        { label: 'Xero Pushed At', readOnly: true, hidden: true },
      created_at:            { label: 'Created', type: 'date', readOnly: true, hidden: true },
    },
  },
  trial_submissions: {
    label: 'Trial Enquiries',
    columns: {
      id:                   { label: 'ID', readOnly: true },
      submitted_at:         { label: 'Submitted', readOnly: true },
      student_name:         { label: 'Student Name', required: true },
      student_year:         { label: 'Year', type: 'singleSelect', options: YEAR_OPTIONS },
      school:               { label: 'School' },
      parent_name:          { label: 'Parent Name' },
      parent_email:         { label: 'Parent Email', type: 'email' },
      parent_phone:         { label: 'Parent Phone', type: 'phone' },
      student_email:        { label: 'Student Email', type: 'email', hidden: true },
      student_phone:        { label: 'Student Phone', type: 'phone', hidden: true },
      status:               { label: 'Status', type: 'singleSelect', options: ['new','contacted','trial_scheduled','enrolled','declined'], required: true, help: 'Pipeline stage — matches the Trials page workflow.' },
      trial_date:           { label: 'Trial Date', type: 'date' },
      trial_class_id:       { label: 'Trial Class', type: 'linkedRecord', linked: { refTable: 'classes', refValue: 'id', refLabel: 'class_name' } },
      converted_student_id: { label: 'Converted Student', readOnly: true, hidden: true },
      enrolment_id:         { label: 'Enrolment', readOnly: true, hidden: true },
      source:               { label: 'Source', readOnly: true, hidden: true },
      how_heard:            { label: 'How Heard', type: 'singleSelect', options: ['Referral (friend / family)','Google Search','Google Maps','Social media','School word of mouth','Flyer / local advertising','Walked past','Returning family','Other'], help: 'Acquisition channel — powers the Channels report on the Trials page.' },
      referred_by:          { label: 'Referred By', help: 'Name of the referring family ($50 referral program).' },
      availability:         { label: 'Availability', type: 'json', hidden: true },
      admin_notes:          { label: 'Admin Notes' },
    },
  },
  shifts: {
    label: 'Shifts',
    columns: {
      id:          { label: 'Shift ID', readOnly: true },
      tutor_id:    { label: 'Tutor', type: 'linkedRecord', linked: { refTable: 'tutors', refValue: 'id', refLabel: 'full_name' }, required: true },
      work_date:   { label: 'Date', type: 'date', required: true },
      start_time:  { label: 'Starts', type: 'time' },
      end_time:    { label: 'Ends', type: 'time' },
      hours:       { label: 'Hours', type: 'number', required: true },
      kind:        { label: 'Kind' },
      status:      { label: 'Status', type: 'singleSelect', options: ['draft','submitted','approved','paid'], required: true },
      rate_snapshot: { label: 'Rate', type: 'currency', readOnly: true },
      source_table:  { label: 'Source Table', readOnly: true, hidden: true },
      source_id:     { label: 'Source ID', readOnly: true, hidden: true },
      pay_run_id:    { label: 'Pay Run', readOnly: true, hidden: true },
      submitted_at:  { label: 'Submitted At', readOnly: true, hidden: true },
      approved_at:   { label: 'Approved At', readOnly: true, hidden: true },
      approved_by:   { label: 'Approved By', readOnly: true, hidden: true },
      created_at:    { label: 'Created', readOnly: true, hidden: true },
      created_by:    { label: 'Created By', readOnly: true, hidden: true },
      updated_at:    { label: 'Updated', readOnly: true, hidden: true },
      notes:         { label: 'Notes' },
    },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function colMeta(table, col) {
  return TABLE_META[table]?.columns?.[col] ?? null
}

/** Dropdown options for a column, or null if it's not a singleSelect. */
export function dropdownOptions(table, col) {
  const m = colMeta(table, col)
  return m?.type === 'singleSelect' && Array.isArray(m.options) ? m.options : null
}

/** Friendly header label (falls back to the raw column name). */
export function columnLabel(table, col) {
  return colMeta(table, col)?.label ?? col
}

/** Tooltip text: raw name + help + deprecation note. */
export function columnTooltip(table, col) {
  const m = colMeta(table, col)
  const parts = [`Column: ${col}`]
  if (m?.help) parts.push(m.help)
  if (m?.deprecated) parts.push(`Deprecated: ${m.deprecated}`)
  if (m?.readOnly) parts.push('Read-only / derived value.')
  return parts.join('\n')
}

export function isRequired(table, col)  { return !!colMeta(table, col)?.required }
export function isDeprecated(table, col){ return !!colMeta(table, col)?.deprecated }

/** Columns hidden by default on first visit (only used when the user has no saved layout). */
export function defaultHiddenCols(table, allCols) {
  const cols = TABLE_META[table]?.columns
  if (!cols) return []
  return allCols.filter(c => cols[c]?.hidden)
}

// ── Validation (warning-level only — callers should warn, never block/rewrite) ─

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Australian-friendly: allows +61, leading 0, spaces, brackets and dashes.
const PHONE_RE = /^[+]?[\d][\d\s()-]{5,16}$/
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE  = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const URL_RE   = /^(https?:\/\/)[^\s.]+\.[^\s]{2,}$/i
const MONEY_RE = /^-?\$?\s*\d+(\.\d+)?$/

/**
 * Validate a value against column metadata.
 * Returns null if fine, or a human-readable warning string.
 * Empty/null values only warn when the column is required.
 */
export function validateValue(table, col, value) {
  const m = colMeta(table, col)
  if (!m) return null
  // Whitespace never matters: values are trimmed on save everywhere, and
  // validation always runs against the trimmed value.
  const s = value === null || value === undefined ? '' : String(value).trim()
  if (s === '') return m.required ? `"${m.label ?? col}" is a required field.` : null
  switch (m.type) {
    case 'email':    return EMAIL_RE.test(s) ? null : `"${s}" doesn't look like a valid email.`
    case 'phone':    return PHONE_RE.test(s) ? null : `"${s}" doesn't look like a valid phone number.`
    case 'url':      return URL_RE.test(s) ? null : `"${s}" doesn't look like a valid URL (include http:// or https://).`
    case 'integer':  return /^-?\d+$/.test(s) ? null : `"${s}" should be a whole number.`
    case 'number':   return /^-?\d+(\.\d+)?$/.test(s) ? null : `"${s}" should be a number.`
    case 'currency': return MONEY_RE.test(s) ? null : `"${s}" should be an amount (e.g. 120 or 120.50).`
    case 'percent':  return /^-?\d+(\.\d+)?%?$/.test(s) ? null : `"${s}" should be a percentage (e.g. 15 or 15%).`
    case 'date':     return DATE_RE.test(s) ? null : `"${s}" should be a date (YYYY-MM-DD).`
    case 'datetime': return Number.isNaN(Date.parse(s)) ? `"${s}" should be a valid date/time.` : null
    case 'time':     return TIME_RE.test(s) ? null : `"${s}" should be a 24h time (HH:MM).`
    case 'boolean':  return ['true','false'].includes(s.toLowerCase()) ? null : `"${s}" should be true or false.`
    case 'singleSelect':
      return m.options.includes(s) ? null
        : `"${s}" isn't one of the expected values (${m.options.join(', ')}).`
    default: return null
  }
}

// ── Display / editor type helpers (additive — never mutate stored values) ──────

/** Resolved column type, defaulting to 'text' when unspecified. */
export function fieldType(table, col) {
  return colMeta(table, col)?.type ?? 'text'
}

/** True for foreign-key / linked-record columns. */
export function isLinked(table, col) {
  return fieldType(table, col) === 'linkedRecord'
}

/** The { refTable, refValue, refLabel } descriptor for a linked column, or null. */
export function linkedRef(table, col) {
  const m = colMeta(table, col)
  return m?.type === 'linkedRecord' ? (m.linked ?? null) : null
}

export function isReadOnly(table, col) { return !!colMeta(table, col)?.readOnly }

/**
 * Which editor widget a cell should use. Pure UI hint; the explorer falls back
 * to a plain text input for anything it doesn't special-case.
 *   'select' | 'linked' | 'date' | 'datetime' | 'time' | 'boolean' |
 *   'number' | 'currency' | 'percent' | 'longtext' | 'text'
 */
export function fieldEditorKind(table, col) {
  const m = colMeta(table, col)
  if (!m) return 'text'
  if (m.type === 'singleSelect') return 'select'
  if (m.type === 'linkedRecord') return 'linked'
  switch (m.type) {
    case 'date': case 'datetime': case 'time':
    case 'boolean': case 'number': case 'currency':
    case 'percent': case 'longtext':
      return m.type
    default: return 'text'
  }
}

const AUD_CURRENCY = (typeof Intl !== 'undefined')
  ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
  : null

/** Format a number as AUD currency for display. Returns '' for blank input. */
export function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(String(value).replace(/[^0-9.-]/g, ''))
  if (Number.isNaN(n)) return String(value)            // show unparseable values safely
  return AUD_CURRENCY ? AUD_CURRENCY.format(n) : `$${n.toFixed(2)}`
}

/** Readable date (e.g. 3 Mar 2026). Falls back to the raw string if unparseable. */
export function formatDate(value) {
  if (!value) return ''
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Readable date + time. Falls back to the raw string if unparseable. */
export function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Display string for a value given its column type. Pure formatting — it never
 * changes what is stored, and returns the raw value safely if it can't format.
 * Linked records are resolved by the caller (needs a lookup), so they are not
 * handled here.
 */
export function formatDisplay(table, col, value) {
  if (value === null || value === undefined || value === '') return ''
  switch (fieldType(table, col)) {
    case 'currency': return formatCurrency(value)
    case 'percent':  return `${String(value).replace(/%$/, '')}%`
    case 'date':     return formatDate(value)
    case 'datetime': return formatDateTime(value)
    case 'boolean':  return value === true || value === 'true' ? 'Yes' : 'No'
    default:         return String(value)
  }
}
