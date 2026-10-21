/*
 * A new version of the portal went live while this tab (or the iPhone app)
 * was open: its JavaScript still points at the previous build's chunk files,
 * which each deploy replaces, so the first navigation that needs one fails
 * with a ChunkLoadError — and the page "breaks". The fix is simply to load
 * the new version. The error boundaries (app/error.js, app/global-error.js)
 * do that once, quietly, instead of showing the crash screen.
 */
const STALE_RE = /ChunkLoadError|Failed to load chunk|Loading (CSS )?chunk [\w-]+ failed|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i

export const isStaleBuildError = (error) => STALE_RE.test(`${error?.name || ''} ${error?.message || error || ''}`)

const KEY = 'cube:stale-build-reload'

// Reload to pick up the new build. Up to three reloads per five minutes: a
// single navigation can trip over more than one missing chunk in quick
// succession (the old once-a-minute guard left the second one on the crash
// screen), while a chunk that is genuinely missing still can't loop forever.
// Returns whether it is reloading.
export function reloadForNewBuild() {
  try {
    const now = Date.now()
    const recent = JSON.parse(sessionStorage.getItem(KEY) || '[]')
      .filter((t) => Number.isFinite(t) && now - t < 300000)
    if (recent.length >= 3) return false
    sessionStorage.setItem(KEY, JSON.stringify([...recent, now]))
  } catch { return false }   // no storage: can't guard against a loop, so don't
  window.location.reload()
  return true
}
