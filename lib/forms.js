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
// The one place this URL is written down — emails link to it too.
export const FREE_TRIAL_URL = 'https://www.cubetuition.com.au/free-trial'

export const WEBSITE_FORMS = [
  { title: 'Free Trial Request', url: FREE_TRIAL_URL, note: 'On the website. Submissions appear under Trials.', href: '/tutor/trials' },
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

// ── Notification email ───────────────────────────────────────────────────────
const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The email the office receives for each submission: the CUBE shell, the form's
// title, every answer in a two-column table (blank answers greyed), when it
// came in, and a button to the Forms page. Pure — safe on the server.
export function buildFormSubmissionEmailHtml(form, data = {}, { submittedAt = new Date(), site = '' } = {}) {
  const when = new Date(submittedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const rows = (form.fields || []).map((f, i) => {
    const v = formatValue(data[f.key])
    const cell = v
      ? escHtml(v).replace(/\n/g, '<br/>')
      : '<span style="color:#9AA0B4;font-style:italic;">not answered</span>'
    return `<tr style="background:${i % 2 ? '#FBFCFF' : '#ffffff'};">
        <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#325099;vertical-align:top;width:38%;border-bottom:1px solid #EEF2FB;">${escHtml(f.label)}</td>
        <td style="padding:10px 14px;font-size:14px;color:#2A2035;line-height:1.55;vertical-align:top;border-bottom:1px solid #EEF2FB;">${cell}</td>
      </tr>`
  }).join('')
  const link = `${site}/tutor/admin/forms`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:28px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#325099;text-transform:uppercase;letter-spacing:1px;">New form submission</p>
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#062E63;">${escHtml(form.title)}</h1>
      <p style="margin:0 0 22px;font-size:13px;color:#6B6880;">Received ${escHtml(when)}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #DEE7FF;border-radius:12px;overflow:hidden;">
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:center;margin:28px 0 6px;">
        <a href="${escHtml(link)}" style="display:inline-block;background:#062E63;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.3px;padding:12px 28px;border-radius:10px;">Open in the portal</a>
      </div>
      <p style="margin:18px 0 0;font-size:11px;color:#9AA0B4;text-align:center;">Sent by the CUBE Portal when someone submits the ${escHtml(form.title)} form.</p>
    </div>
  </body></html>`
}
