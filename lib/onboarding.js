/*
 * Tutor onboarding — shared by the director page (/tutor/admin/onboarding),
 * the tutor's upload page (/onboarding/<token>) and the /api/onboarding
 * routes. Pure: no Supabase here, so the email preview the director sees is
 * built by the same function the send route uses.
 *
 * The pack (CUBE Onboarding Document, "Confirmation"): the tutor returns six
 * documents before starting work — the three CUBE documents (two signed, one
 * completed) and three government forms.
 */

export const ONBOARDING_BUCKET = 'onboarding'
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024   // matches the bucket limit
export const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

// The CUBE documents attached to the email, kept in the bucket's templates/.
export const TEMPLATES = [
  { key: 'agreement',  label: 'CUBE Employment Agreement',          path: 'templates/employment-agreement.pdf',         filename: 'CUBE Employment Agreement.pdf' },
  { key: 'code',       label: 'CUBE Child Safety Code of Conduct',  path: 'templates/child-safety-code-of-conduct.pdf', filename: 'CUBE Child Safety Code of Conduct.pdf' },
  { key: 'onboarding', label: 'CUBE Onboarding Document',           path: 'templates/onboarding-document.pdf',          filename: 'CUBE Onboarding Document.pdf' },
]

export const SUPER_CHOICE_URL = 'https://www.ato.gov.au/forms-and-instructions/superannuation-standard-choice-form'
export const TFN_URL = 'https://www.opc.gov.au/sites/default/files/2024-09/TFN_declaration_form_N3092.pdf'

// The six documents the tutor uploads back, in the order the Onboarding
// Document lists them.
export const DOCS = [
  { key: 'agreement',    label: 'CUBE Employment Agreement',             hint: 'Signed on the last page.', template: 'agreement' },
  { key: 'code',         label: 'CUBE Child Safety Code of Conduct',     hint: 'Signed acknowledgement (section 8).', template: 'code' },
  { key: 'onboarding',   label: 'CUBE Onboarding Document',              hint: 'Every section completed and signed.', template: 'onboarding' },
  { key: 'super_choice', label: 'Superannuation standard choice form',   hint: 'The ATO form, with the employee section completed.', link: SUPER_CHOICE_URL },
  { key: 'super_letter', label: 'Letter of compliance from your super fund', hint: 'Ask your fund for it — the choice form explains what it is.' },
  { key: 'tfn',          label: 'Tax File Number declaration',           hint: 'The ATO form, completed.', link: TFN_URL },
]
export const DOC_KEYS = DOCS.map(d => d.key)

export const STATUS_LABEL = { draft: 'Not sent', sent: 'Waiting on documents', submitted: 'All documents in', complete: 'Complete' }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there'
const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export const onboardingSubject = () => 'Welcome to CUBE Tuition — your onboarding documents'

/*
 * The email. o = { full_name, start_date, note }, link = the upload page URL,
 * attached = the filenames attached (shown so the tutor can match them up).
 */
export function buildOnboardingEmailHtml(o, link, attached = []) {
  const NAVY = '#062E63', BLUE = '#325099', INK = '#2A2035'
  const p = (html, style = '') => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${INK};${style}">${html}</p>`
  const start = fmtDate(o.start_date)
  const steps = [
    'Read the <strong>CUBE Employment Agreement</strong> and sign the last page.',
    'Read the <strong>CUBE Child Safety Code of Conduct</strong> and sign the acknowledgement.',
    'Complete every section of the <strong>CUBE Onboarding Document</strong> and sign the declaration.',
    `Download the <a href="${SUPER_CHOICE_URL}" style="color:${BLUE};">Superannuation standard choice form</a> from the ATO, complete the employee section, and ask your super fund for a <strong>letter of compliance</strong>.`,
    `Complete a <a href="${TFN_URL}" style="color:${BLUE};">Tax File Number declaration</a>.`,
    'Upload all six documents using the button below.',
  ]
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:${INK};background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
    <div style="background:linear-gradient(120deg,#04204a 0%,${NAVY} 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:30px;">
      <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
      <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
    </div>
    ${p(`Hi ${esc(firstName(o.full_name))},`)}
    ${p(`Welcome to CUBE Tuition — we're really glad to have you on the team.${start ? ` You start on <strong>${esc(start)}</strong>.` : ''}`)}
    ${o.note ? p(esc(o.note).replace(/\n/g, '<br/>')) : ''}
    ${p('Before your first lesson, we need a few documents from you. Everything you need is attached to this email:')}
    ${attached.length ? `<ul style="margin:0 0 18px;padding-left:20px;font-size:14.5px;line-height:1.7;color:${INK};">${attached.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <div style="margin:0 0 22px;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${NAVY};">What to do</p>
      <ol style="margin:0;padding-left:20px;font-size:14.5px;line-height:1.75;color:${INK};">${steps.map(s => `<li style="margin-bottom:4px;">${s}</li>`).join('')}</ol>
    </div>
    <div style="text-align:center;margin:0 0 22px;">
      <a href="${link}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;">Upload your documents →</a>
      <p style="margin:10px 0 0;font-size:12px;color:${BLUE};opacity:0.7;">This link is just for you — please don't share it.</p>
    </div>
    ${p('Your bank, tax and super details go straight to our private storage through that link, so please upload them there rather than replying with them by email.', 'font-size:13.5px;color:#5b5568;')}
    ${p('If you have any questions, just reply to this email.')}
    <p style="margin:24px 0 0;font-size:15px;line-height:1.7;color:${INK};">Kind regards,<br/>The CUBE Team</p>
  </div>
  </body></html>`
}
