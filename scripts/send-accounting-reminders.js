/**
 * CUBE Tuition — Accounting Due Date Reminder
 *
 * Sends an email via Resend when an accounting due date is 60 or 30 days away.
 * Run daily via Cowork scheduled task.
 *
 * Reads RESEND_API_KEY, RESEND_FROM_EMAIL, ADMIN_EMAIL from .env.local
 */

const fs   = require('fs')
const path = require('path')
const https = require('https')

// ── Load .env.local ────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('.env.local not found'); process.exit(1) }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    env[key] = val
  }
  return env
}

// ── Due dates (keep in sync with due-dates page) ───────────────────────────────
const DUE_DATES = [
  // BAS
  { label: 'BAS Q4 FY2025–26',        category: 'BAS',         due: '2026-07-28' },
  { label: 'BAS Q1 FY2026–27',        category: 'BAS',         due: '2026-10-28' },
  { label: 'BAS Q2 FY2026–27',        category: 'BAS',         due: '2027-02-28' },
  // Superannuation
  { label: 'Super Q4 FY2025–26',      category: 'Super',       due: '2026-07-28' },
  { label: 'Super Q1 FY2026–27',      category: 'Super',       due: '2026-10-28' },
  { label: 'Super Q2 FY2026–27',      category: 'Super',       due: '2027-01-28' },
  // Company Tax Return
  { label: 'Company Tax Return FY2025–26', category: 'Tax Return', due: '2026-10-31' },
  { label: 'Company Tax Return FY2026–27', category: 'Tax Return', due: '2027-10-31' },
  // ASIC
  { label: 'ASIC Annual Review Fee',  category: 'ASIC',        due: '2026-10-01' },
]

const THRESHOLDS = [
  { days: 60, label: '2 months' },
  { days: 30, label: '1 month'  },
  { days: 14, label: '2 weeks'  },
]

// ── Date helpers ───────────────────────────────────────────────────────────────
function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0)
  const due   = new Date(dateStr + 'T00:00:00')
  return Math.round((due - today) / (1000 * 60 * 60 * 24))
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Resend ─────────────────────────────────────────────────────────────────────
function sendEmail({ apiKey, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from, to: [to], subject, html })
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function buildHtml(reminders) {
  const rows = reminders.map(({ item, threshold }) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #DEE7FF;font-weight:600;color:#062E63;">${item.label}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #DEE7FF;color:#325099;">${item.category}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #DEE7FF;color:#2A2035;">${fmtDate(item.due)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #DEE7FF;">
        <span style="background:#FEF3C7;color:#92400E;font-weight:700;padding:2px 8px;border-radius:999px;font-size:12px;">
          ${threshold.days}d / ${threshold.label}
        </span>
      </td>
    </tr>
  `).join('')

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;">
      <div style="background:#062E63;border-radius:12px;padding:18px 24px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;">CUBE</span>
        <span style="color:rgba(255,255,255,0.55);font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      </div>
      <p style="font-size:15px;margin:0 0 8px 0;font-weight:600;">📅 Upcoming accounting due date${reminders.length > 1 ? 's' : ''}</p>
      <p style="font-size:13px;color:#325099;margin:0 0 24px 0;">The following obligation${reminders.length > 1 ? 's are' : ' is'} coming up soon. Please ensure ${reminders.length > 1 ? 'they are' : 'it is'} lodged and paid on time.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #DEE7FF;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#F8FAFF;">
            <th style="padding:8px 16px;text-align:left;font-size:11px;color:#325099;text-transform:uppercase;letter-spacing:0.05em;">Obligation</th>
            <th style="padding:8px 16px;text-align:left;font-size:11px;color:#325099;text-transform:uppercase;letter-spacing:0.05em;">Type</th>
            <th style="padding:8px 16px;text-align:left;font-size:11px;color:#325099;text-transform:uppercase;letter-spacing:0.05em;">Due Date</th>
            <th style="padding:8px 16px;text-align:left;font-size:11px;color:#325099;text-transform:uppercase;letter-spacing:0.05em;">Remaining</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:12px;color:#325099;margin-top:24px;">Always confirm deadlines with your accountant — extensions may apply.</p>
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #DEE7FF;font-size:11px;color:#325099;opacity:0.6;">
        CUBE Tuition · Automated reminder from the CUBE staff portal.
      </div>
    </div>
  `
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const env       = loadEnv()
  const apiKey    = env.RESEND_API_KEY
  const fromEmail = env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
  const toEmail   = env.ADMIN_EMAIL       || env.RESEND_FROM_EMAIL || 'admin@cubetuition.com.au'

  if (!apiKey) { console.error('Missing RESEND_API_KEY'); process.exit(1) }

  // Find items hitting a threshold today (±1 day window in case of missed runs)
  const reminders = []
  for (const item of DUE_DATES) {
    const days = daysUntil(item.due)
    for (const threshold of THRESHOLDS) {
      if (Math.abs(days - threshold.days) <= 1) {
        reminders.push({ item, threshold })
      }
    }
  }

  if (reminders.length === 0) {
    console.log(`[${new Date().toISOString()}] No reminders due today.`)
    return
  }

  const subject = `⏰ Accounting reminder: ${reminders.map(r => r.item.label).join(', ')}`
  const html    = buildHtml(reminders)
  const result  = await sendEmail({ apiKey, from: `CUBE Tuition <${fromEmail}>`, to: toEmail, subject, html })

  if (result.status >= 200 && result.status < 300) {
    console.log(`[${new Date().toISOString()}] Reminder sent to ${toEmail} for: ${reminders.map(r => r.item.label).join(', ')}`)
  } else {
    console.error(`[${new Date().toISOString()}] Send failed (${result.status}): ${result.body}`)
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
