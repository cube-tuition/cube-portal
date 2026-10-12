/*
 * `npm test` — runs every tests/**\/*.test.mjs with node's built-in runner.
 *
 * Also the deploy gate: vercel.json builds with `npm test && npm run build`,
 * so a failing money test stops the deploy and production stays on the last
 * good version. Finds the files itself (node --test only expands globs from
 * Node 21) and only passes flags this Node knows.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.test.mjs')) files.push(path.relative(root, p))
  }
}
walk(path.join(root, 'tests'))
files.sort()

// lib/*.js are ES modules in a package without "type": "module" — harmless,
// but Node says so once per file.
const flags = process.allowedNodeEnvironmentFlags.has('--disable-warning')
  ? ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'] : []

const r = spawnSync(process.execPath, [...flags, '--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' })
process.exit(r.status ?? 1)
