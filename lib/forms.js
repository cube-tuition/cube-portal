/*
 * Portal-hosted forms — shared by the admin editor (/tutor/admin/forms), the
 * public page (/forms/[slug]) and the submit route. A form is a list of fields;
 * a submission is { field key: value } where checkbox fields hold arrays.
 */

export const FIELD_TYPES = [
  { type: 'text',       label: 'Short text' },
  { type: 'email',      label: 'Email' },
  { type: 'tel',        label: 'Phone' },
  { type: 'number',     label: 'Number' },
  { type: 'date',       label: 'Date' },
  { type: 'textarea',   label: 'Long text' },
  { type: 'select',     label: 'Dropdown' },
  { type: 'radio',      label: 'Choose one' },
  { type: 'checkboxes', label: 'Choose many' },
]
export const OPTION_TYPES = ['select', 'radio', 'checkboxes']

// Forms families reach on the website rather than in the portal, listed on the
// admin page so every form has one home. Submissions from the free-trial form
// land in /tutor/trials via /api/trial-submission.
export const WEBSITE_FORMS = [
  { title: 'Free Trial Request', url: 'https://www.cubetuition.com.au/free-trial', note: 'On the website. Submissions appear under Trials.', href: '/tutor/trials' },
]

export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
export const keyify  = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

// The public base URL. In the browser the current origin is right by
// definition (localhost while developing); on the server fall back to the
// configured site URL.
export function siteUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://portal.cubetuition.com.au').replace(/\/+$/, '')
}
export const publicFormUrl = (slug) => `${siteUrl()}/forms/${slug}`

export const blankField = () => ({ key: '', label: '', type: 'text', required: false, placeholder: '', options: [] })

// Validate a submission against the form's fields. Returns { ok, errors: {key: msg}, data }
// with the data trimmed and reduced to known keys.
export function validateSubmission(fields = [], raw = {}) {
  const errors = {}
  const data = {}
  for (const f of fields) {
    if (!f?.key) continue
    let v = raw[f.key]
    if (f.type === 'checkboxes') {
      v = Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []
      if (f.required && !v.length) errors[f.key] = 'Choose at least one'
    } else {
      v = typeof v === 'string' ? v.trim() : (v == null ? '' : String(v))
      if (f.required && !v) errors[f.key] = 'Required'
      else if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.key] = 'Enter a valid email address'
      if (v.length > 2000) errors[f.key] = 'Too long'
    }
    data[f.key] = v
  }
  return { ok: Object.keys(errors).length === 0, errors, data }
}

// One line per field, for the notification email and CSV export.
export function formatValue(v) {
  if (Array.isArray(v)) return v.join(', ')
  return v == null ? '' : String(v)
}
