/*
 * The morning system check — lib/systemHealth.js healthProblems(). Pure.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { healthProblems, healthPush } from '../lib/systemHealth.js'

const now = new Date('2026-10-14T21:30:00Z')                    // Thu 8:30am Sydney
const hoursAgo = (h) => new Date(now.getTime() - h * 3600e3).toISOString()
const ok = (h) => ({ ok: true, finished_at: hoursAgo(h), error: null })
const fail = (h, error = 'boom') => ({ ok: false, finished_at: hoursAgo(h), error })
const titles = (p) => p.map(x => `${x.severity}: ${x.title}`)

describe('scheduled jobs', () => {
  test('both jobs ran this morning: all clear', () => {
    assert.deepEqual(healthProblems({ now, runsByJob: { daily: [ok(1)], xero_reconcile: [ok(2)] } }), [])
  })

  test('a job that has not succeeded for over a day is red', () => {
    const p = healthProblems({ now, runsByJob: { daily: [ok(50)], xero_reconcile: [ok(2)] } })
    assert.equal(p.length, 1)
    assert.equal(p[0].severity, 'red')
    assert.match(p[0].title, /^The morning job .* hasn't run since /)
  })

  test('a job that failed this morning is red, with its error', () => {
    const p = healthProblems({ now, runsByJob: { daily: [fail(1, 'draft invoice sync: timeout'), ok(25)], xero_reconcile: [ok(2)] } })
    assert.deepEqual(p.map(x => [x.severity, x.detail]), [['red', 'draft invoice sync: timeout']])
    assert.match(p[0].title, /failed at/)
  })

  test('a failure followed by a good run is only worth knowing', () => {
    const p = healthProblems({ now, runsByJob: { daily: [ok(1), fail(20)], xero_reconcile: [ok(2)] } })
    assert.deepEqual(titles(p), ['amber: The morning job (reminders, draft invoices, payroll matching) failed once, then recovered'])
  })

  test('a job that has never succeeded is red; one never recorded is not judged yet', () => {
    const p = healthProblems({ now, runsByJob: { daily: [fail(1, 'Xero needs reconnecting')], xero_reconcile: [] } })
    assert.deepEqual(p.map(x => [x.severity, x.detail]), [['red', 'Xero needs reconnecting']])
  })

  test('the watchdog can judge just the morning job', () => {
    const p = healthProblems({ now, jobs: ['daily'], runsByJob: { daily: [ok(48)] } })
    assert.equal(p.length, 1)
  })
})

describe('queue and crashes', () => {
  const clear = { daily: [ok(1)], xero_reconcile: [ok(2)] }

  test('enrolment changes waiting more than a day are flagged; recent ones are not', () => {
    assert.deepEqual(healthProblems({ now, runsByJob: clear, oldestQueuedAt: hoursAgo(2) }), [])
    assert.match(healthProblems({ now, runsByJob: clear, oldestQueuedAt: hoursAgo(30) })[0].title, /stuck on the way to draft invoices/)
  })

  test('crashes are counted and grouped by message, most frequent first', () => {
    const recentErrors = [
      { message: 'fmtPct is not defined', route: '/tutor/admin/marketing' },
      { message: 'channel error', route: '/workbook/a?class=1' },
      { message: 'channel error', route: '/workbook/b?class=2' },
    ]
    const [p] = healthProblems({ now, runsByJob: clear, recentErrors })
    assert.equal(p.title, '3 crashes in the portal in the last day')
    assert.equal(p.detail, '"channel error" on /workbook/a, /workbook/b (×2) · "fmtPct is not defined" on /tutor/admin/marketing')
  })
})

test('the phone push leads with the most serious, and names the first problems', () => {
  const push = healthPush([{ severity: 'amber', title: 'A' }, { severity: 'red', title: 'B' }], 'health-x')
  assert.equal(push.title, '🔴 Portal check: 2 things to look at')
  assert.equal(push.body, 'A · B')
  assert.equal(push.url, '/tutor')
})
