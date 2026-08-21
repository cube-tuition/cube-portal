/*
 * Unauthenticated smoke pass over the student-facing routes.
 *
 *   npm run smoke                    # against http://localhost:3000
 *   BASE_URL=https://… npm run smoke # against a deploy
 *
 * Exists because of the Aug 14 outage: a stray token turned into live code and
 * crashed every student page render for five days, while staff — who use
 * different routes — saw nothing. That crash fired for UNAUTHENTICATED
 * visitors too, so a pass like this one, with no login and no fixtures, would
 * have caught it the same afternoon. This is deliberately shallow: it proves
 * each route HYDRATES without an uncaught error, nothing more.
 *
 * A route passes when, in a real Chrome:
 *   • the document responds below 500
 *   • no uncaught page error fires while it settles (React render crashes
 *     rethrow to window.onerror in production, so this catches them)
 *   • neither our error boundary ("Something broke on this page") nor Next's
 *     production fallback ("Application error") is on screen.
 * Redirecting to the login page is a PASS — unauthenticated visitors should
 * be turned away; they should not be crashed on.
 *
 * Uses puppeteer-core + the system Chrome so nothing downloads a browser.
 */
import puppeteer from 'puppeteer-core'

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

// A syntactically-valid id is all the dynamic routes need: an unauthenticated
// visitor is redirected (or shown "not found") before any row is fetched.
const UUID = '00000000-0000-4000-8000-000000000000'

const ROUTES = [
  '/',
  '/dashboard',
  '/classes',
  `/classes/1`,
  '/pastpapers',
  '/dropin',
  '/archive',
  '/resources',
  `/workbook/${UUID}?class=1`,
  `/workbook/view/${UUID}`,
]

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean)

async function findChrome() {
  const { existsSync } = await import('node:fs')
  const path = CHROME_PATHS.find((p) => existsSync(p))
  if (!path) throw new Error('No Chrome found — set CHROME_PATH')
  return path
}

// First hit of a route on a dev server compiles it, which can take ~a minute
// on this codebase; a deploy answers in milliseconds. Budget for the worst.
const NAV_TIMEOUT = 90_000
const SETTLE_MS = 2_500

const run = async () => {
  const browser = await puppeteer.launch({ executablePath: await findChrome(), headless: true })
  const failures = []
  try {
    for (const route of ROUTES) {
      const page = await browser.newPage()
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)))
      let status = null
      let failure = null
      try {
        const res = await page.goto(BASE + route, { waitUntil: 'load', timeout: NAV_TIMEOUT })
        status = res?.status() ?? null
        await new Promise((r) => setTimeout(r, SETTLE_MS))   // let hydration + redirects land
        const text = await page.evaluate(() => document.body?.innerText || '')
        if (status >= 500) failure = `HTTP ${status}`
        else if (pageErrors.length) failure = `uncaught: ${pageErrors[0].slice(0, 120)}`
        else if (text.includes('Something broke on this page')) failure = 'error boundary rendered'
        else if (text.includes('Application error')) failure = 'Next.js error fallback rendered'
      } catch (e) {
        failure = `navigation failed: ${String(e.message).slice(0, 120)}`
      }
      const finalPath = await page.evaluate(() => location.pathname).catch(() => '?')
      console.log(`${failure ? '✗ FAIL' : '✓ pass'}  ${route.padEnd(44)} → ${finalPath}${failure ? `   ${failure}` : ''}`)
      if (failure) failures.push({ route, failure })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error(`\n${failures.length} of ${ROUTES.length} student routes are broken for an unauthenticated visitor.`)
    process.exit(1)
  }
  console.log(`\nAll ${ROUTES.length} student routes hydrate cleanly.`)
}

run().catch((e) => { console.error(e); process.exit(1) })
