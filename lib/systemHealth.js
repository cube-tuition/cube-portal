/*
 * The portal's morning system check.
 *
 * Every scheduled job records one row in job_runs when it finishes
 * (recordJob). The morning cron then checks:
 *   • did each watched job succeed within the last day?
 *   • did any job fail?
 *   • are enrolment changes stuck in the invoice sync queue?
 *   • have people hit crashes in the portal (client_errors)?
 * The result is kept as a 'health_check' job_runs row (the Action Centre's
 * System card reads it) and pushed to the directors' phones when anything is
 * wrong. The Xero reconcile cron runs a check on the morning job alone, so a
 * morning job that dies outright is still noticed.
 *
 * healthProblems() is pure (tests/systemHealth.test.mjs); checkSystemHealth()
 * loads its inputs with a service-role client.
 */

// Jobs expected to succeed at least once a day.
export const WATCHED_JOBS = {
  daily: 'The morning job (reminders, draft invoices, payroll matching)',
  xero_reconcile: 'The Xero payroll reconcile',
}
const HOUR = 3600 * 1000
const STALE_HOURS = 26          // daily jobs, with slack for a late run

const fmtWhen = (iso) => new Date(iso).toLocaleString('en-AU', {
  timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
})

/*
 * What is wrong, from already-loaded facts.
 *   runsByJob      { job → [{ ok, finished_at, error }] } newest first
 *   oldestQueuedAt ISO time of the oldest invoice_sync_queue row, or null
 *   recentErrors   [{ message, route }] client_errors from the last 24h
 *   jobs           which jobs to judge (default: all WATCHED_JOBS)
 * Returns [{ severity: 'red' | 'amber', title, detail }].
 */
export function healthProblems({ runsByJob = {}, oldestQueuedAt = null, recentErrors = [], now = new Date(), jobs = Object.keys(WATCHED_JOBS) }) {
  const out = []
  const ago = (iso) => (now - new Date(iso)) / HOUR

  for (const job of jobs) {
    const label = WATCHED_JOBS[job] || job
    const runs = runsByJob[job] || []
    if (!runs.length) continue                 // never recorded yet: nothing to judge
    const lastOk = runs.find(r => r.ok)
    if (!lastOk) {
      out.push({ severity: 'red', title: `${label} has not succeeded`, detail: runs[0].error || 'Every recorded run failed.' })
    } else if (ago(lastOk.finished_at) > STALE_HOURS) {
      out.push({ severity: 'red', title: `${label} hasn't run since ${fmtWhen(lastOk.finished_at)}`,
        detail: 'It should run every morning. Check the Vercel cron and its logs.' })
    }
    const failed = runs.find(r => !r.ok && ago(r.finished_at) <= STALE_HOURS)
    if (failed && lastOk && new Date(failed.finished_at) > new Date(lastOk.finished_at)) {
      out.push({ severity: 'red', title: `${label} failed at ${fmtWhen(failed.finished_at)}`, detail: failed.error || 'No error message recorded.' })
    } else if (failed && lastOk) {
      out.push({ severity: 'amber', title: `${label} failed once, then recovered`, detail: failed.error || 'No error message recorded.' })
    }
  }

  if (oldestQueuedAt && ago(oldestQueuedAt) > STALE_HOURS) {
    out.push({ severity: 'amber', title: 'Enrolment changes are stuck on the way to draft invoices',
      detail: `Waiting since ${fmtWhen(oldestQueuedAt)}. Opening the Invoices page retries; if it persists, the sync is failing.` })
  }

  if (recentErrors.length) {
    const groups = new Map()
    for (const e of recentErrors) {
      const g = groups.get(e.message) || { message: e.message, routes: new Set(), n: 0 }
      g.n++; g.routes.add(String(e.route || '').split('?')[0])
      groups.set(e.message, g)
    }
    const top = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 3)
    out.push({
      severity: 'amber',
      title: `${recentErrors.length} crash${recentErrors.length === 1 ? '' : 'es'} in the portal in the last day`,
      detail: top.map(g => `"${String(g.message).slice(0, 80)}" on ${[...g.routes].slice(0, 2).join(', ')}${g.n > 1 ? ` (×${g.n})` : ''}`).join(' · '),
    })
  }
  return out
}

// Load the facts and judge them. `admin` is a service-role client.
export async function checkSystemHealth(admin, { now = new Date(), jobs = Object.keys(WATCHED_JOBS) } = {}) {
  const runsByJob = {}
  for (const job of jobs) {
    const { data, error } = await admin.from('job_runs').select('ok, finished_at, error')
      .eq('job', job).order('finished_at', { ascending: false }).limit(20)
    if (error) throw error
    runsByJob[job] = data || []
  }
  const wantAll = jobs.length === Object.keys(WATCHED_JOBS).length
  let oldestQueuedAt = null, recentErrors = []
  if (wantAll) {
    const { data: q } = await admin.from('invoice_sync_queue').select('queued_at').order('queued_at').limit(1)
    oldestQueuedAt = q?.[0]?.queued_at || null
    const since = new Date(now.getTime() - 24 * HOUR).toISOString()
    const { data: errs } = await admin.from('client_errors').select('message, route').gte('at', since).limit(500)
    recentErrors = errs || []
  }
  return healthProblems({ runsByJob, oldestQueuedAt, recentErrors, now, jobs })
}

// One row per finished job. Never throws: recording must not break the job.
export async function recordJob(admin, job, { startedAt, ok, detail = null, error = null }) {
  try {
    await admin.from('job_runs').insert({
      job, started_at: startedAt || new Date().toISOString(), finished_at: new Date().toISOString(),
      ok, detail, error: error ? String(error).slice(0, 2000) : null,
    })
  } catch (e) { console.error('[jobs] could not record', job, e?.message) }
}

// The push that goes to the directors' phones.
export function healthPush(problems, tag) {
  const red = problems.filter(p => p.severity === 'red').length
  return {
    title: `${red ? '🔴' : '⚠️'} Portal check: ${problems.length} thing${problems.length === 1 ? '' : 's'} to look at`,
    body: problems.slice(0, 3).map(p => p.title).join(' · '),
    url: '/tutor',
    tag,
  }
}
