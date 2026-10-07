// Copies pdf.js's worker into /public with the iOS-18 polyfills prepended.
// Run after upgrading pdfjs-dist: node scripts/copy-pdf-worker.js
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8')
const lib = fs.readFileSync(path.join(__dirname, '..', 'lib/pdfPolyfills.js'), 'utf8')
const m = lib.match(/PDF_POLYFILL_SOURCE = `([\s\S]*?)`/)
if (!m) throw new Error('polyfill source not found')
fs.writeFileSync(path.join(__dirname, '..', 'public/pdf.worker.min.mjs'), m[1] + '\n' + src)
console.log('public/pdf.worker.min.mjs written with polyfills')
