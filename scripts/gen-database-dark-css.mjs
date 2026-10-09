// Generates app/tutor/database/dark.css — a dark palette for the database
// explorer. The explorer is styled with literal colour utilities
// (bg-[#F7F9FD], text-[#2A2035]/60 …), so rather than touching thousands of
// class names this script lists every colour utility the explorer uses and
// emits an override for each under `html.db-dark`. Re-run after restyling:
//   node scripts/gen-database-dark-css.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SOURCES = [
  'app/tutor/database/page.js',
  ...fs.readdirSync(path.join(ROOT, 'components/db')).map(f => `components/db/${f}`),
  'components/SearchSelectPopover.js',
  'components/TutorNav.js',          // the nav sits on this page too
]
const OUT = 'app/tutor/database/dark.css'

// Tailwind named colours the explorer uses (v3 hex values; close enough to v4's oklch).
const NAMED = {
  white: '#ffffff', black: '#000000',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0', 'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a', 'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e', 'amber-900': '#78350f',
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3', 'rose-300': '#fda4af', 'rose-400': '#fb7185', 'rose-500': '#f43f5e', 'rose-600': '#e11d48', 'rose-700': '#be123c',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca', 'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c',
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe', 'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af', 'blue-900': '#1e3a8a',
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa', 'orange-600': '#ea580c', 'orange-700': '#c2410c',
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534',
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3',
  'indigo-100': '#e0e7ff', 'indigo-700': '#4338ca', 'purple-100': '#f3e8ff', 'purple-700': '#7e22ce', 'violet-100': '#ede9fe', 'violet-700': '#6d28d9',
  'sky-100': '#e0f2fe', 'sky-700': '#0369a1', 'teal-100': '#ccfbf1', 'teal-700': '#0f766e',
}

// ── Colour maths ────────────────────────────────────────────────────────────
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
const hslToRgb = ([h, s, l]) => {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255))
}
/**
 * Light → dark, by what the colour is doing:
 *   pale (L ≥ 0.82): a surface or hairline → navy-tinted dark; the palest
 *                    become the darkest, so white panels sit below tinted ones
 *   dark (L ≤ 0.40): text → pale; a filled button or border → lifted a little,
 *                    so navy buttons stay navy with their white labels
 *   mid accents:     lifted a touch so they read on dark
 * Saturation is damped on surfaces so tinted panels do not glow.
 */
function darken(hex, util) {
  let [h, s, l] = rgbToHsl(hexToRgb(hex))
  const isText = util === 'text' || util === 'placeholder'
  const isLine = ['border', 'border-l', 'border-r', 'border-t', 'border-b', 'ring', 'divide', 'outline'].includes(util)
  if (l >= 0.82) {
    if (isText) return hexToRgb(hex)            // pale text sits on navy fills; leave it
    // Most tints sit within a few percent of white, so key off the distance
    // from white and stretch it: white → the page, faint tints → panels,
    // stronger tints → raised chips. Lines sit a step above their surfaces.
    const d = 1 - l                             // white 0 · F7F9FD 0.02 · DEE7FF 0.11
    const grey = s < 0.12
    s = grey ? 0.18 : Math.min(0.28, s * 0.5 + 0.1)
    if (grey) h = 222                           // greys take the navy hue
    l = isLine ? Math.min(0.42, 0.18 + d * 1.8) : Math.min(0.34, 0.09 + d * 3)
  } else if (l <= 0.40) {
    if (isText) { l = 0.80 + (0.40 - l) * 0.35; s = Math.min(s, 0.45) }
    else if (isLine) { l = Math.min(0.62, l + 0.25) }
    else { l = Math.min(0.5, l + 0.08) }        // fills: a shade lighter, still dark
  } else {
    l = Math.min(0.78, l + (isText ? 0.22 : 0.08))
  }
  return hslToRgb([h, s, l])
}
const rgbStr = ([r, g, b], alpha) => alpha == null ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`

// ── Collect tokens ──────────────────────────────────────────────────────────
const TOKEN = /(?<![\w-])((?:(?:hover|focus|active|disabled|group-hover|focus-within|md|sm|lg|xl|placeholder):)*)(bg|text|border|border-[lrtb]|ring|placeholder|divide|outline)-(\[#[0-9a-fA-F]{6}\]|white|black|[a-z]+-\d{2,3})(?:\/(\d{1,3}))?(?![\w-])/g
const tokens = new Map()
for (const f of SOURCES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
  for (const m of src.matchAll(TOKEN)) {
    const [raw, variants, util, colour, alpha] = m
    tokens.set(raw, { variants: variants.split(':').filter(Boolean), util, colour, alpha })
  }
}

const esc = (s) => s.replace(/[\[\]#\/:.%]/g, (c) => '\\' + c)
const PROP = { bg: 'background-color', text: 'color', border: 'border-color', 'border-l': 'border-left-color', 'border-r': 'border-right-color', 'border-t': 'border-top-color', 'border-b': 'border-bottom-color', ring: '--tw-ring-color', outline: 'outline-color', placeholder: 'color', divide: 'border-color' }
const SKIP = new Set(['text-white', 'text-black', 'bg-black'])   // white-on-navy buttons and overlays stay as they are

const rules = []
for (const [raw, t] of tokens) {
  const base = `${t.util}-${t.colour}`
  if (SKIP.has(base)) continue
  const hex = t.colour.startsWith('[') ? t.colour.slice(1, -1) : NAMED[t.colour]
  if (!hex) { console.warn('no hex for', raw); continue }
  const colour = rgbStr(darken(hex.toLowerCase(), t.util), t.alpha ? Number(t.alpha) / 100 : null)
  let sel = `.${esc(raw)}`
  let media = null
  for (const v of t.variants) {
    if (v === 'hover') sel += ':hover'
    else if (v === 'focus') sel += ':focus'
    else if (v === 'active') sel += ':active'
    else if (v === 'disabled') sel += ':disabled'
    else if (v === 'focus-within') sel += ':focus-within'
    else if (v === 'group-hover') sel = `.group:hover ${sel}`
    else if (v === 'placeholder') sel += '::placeholder'
    else if (v === 'md') media = '(min-width: 48rem)'
    else if (v === 'sm') media = '(min-width: 40rem)'
    else if (v === 'lg') media = '(min-width: 64rem)'
    else if (v === 'xl') media = '(min-width: 80rem)'
  }
  if (t.util === 'placeholder') sel += '::placeholder'
  if (t.util === 'divide') sel += ' > :not(:last-child)'
  const rule = `html.db-dark ${sel} { ${PROP[t.util]}: ${colour}; }`
  rules.push(media ? `@media ${media} { ${rule} }` : rule)
}
rules.sort()

const header = `/* Generated by scripts/gen-database-dark-css.mjs — do not edit by hand.
 * Dark palette for the database explorer: one override per colour utility the
 * explorer uses, scoped to html.db-dark. ${rules.length} rules. */
html.db-dark { color-scheme: dark; --db-surface: #0f1420; }
html.db-dark body { background-color: #0f1420; }
html.db-dark .db-explorer { background-color: #0f1420; }
html.db-dark .db-explorer, html.db-dark .db-explorer :where(table, input, textarea, select) { color: rgb(226 230 240); }
html.db-dark ::selection { background: rgb(50 80 153 / 0.6); }
html.db-dark .shadow-sm, html.db-dark .shadow-md, html.db-dark .shadow-lg, html.db-dark .shadow-xl, html.db-dark .shadow-2xl { --tw-shadow-color: rgb(0 0 0 / 0.5); }
`
fs.writeFileSync(path.join(ROOT, OUT), header + rules.join('\n') + '\n')
console.log(`${OUT}: ${rules.length} rules from ${tokens.size} colour utilities`)
