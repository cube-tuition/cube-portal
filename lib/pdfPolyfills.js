/*
 * pdf.js 5.7 uses a few JavaScript features Safari only gained in 2025
 * (Map.getOrInsertComputed, Promise.try, Uint8Array base64 helpers). iPhones
 * on iOS 18 don't have them, and every page came up "could not be drawn".
 * The same code is prepended to the worker file by scripts/copy-pdf-worker.js
 * — keep the two in step.
 */
export const PDF_POLYFILL_SOURCE = `(function () {
  for (const C of [Map, WeakMap]) {
    if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (this.has(k)) return this.get(k); this.set(k, v); return v };
    if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, fn) { if (this.has(k)) return this.get(k); const v = fn(k); this.set(k, v); return v };
  }
  if (!Promise.try) Promise.try = function (fn, ...args) { return new Promise((res) => res(fn(...args))) };
  if (!Uint8Array.fromBase64) Uint8Array.fromBase64 = function (s) { const b = atob(s); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out };
  if (!Uint8Array.prototype.toBase64) Uint8Array.prototype.toBase64 = function () { let s = ''; for (let i = 0; i < this.length; i++) s += String.fromCharCode(this[i]); return btoa(s) };
})();`

export function installPdfPolyfills() {
  if (typeof window === 'undefined' || window.__pdfPolyfilled) return
  window.__pdfPolyfilled = true
  new Function(PDF_POLYFILL_SOURCE)()
}
