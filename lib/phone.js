/*
 * Phone numbers as families type them ("0413 948 411", "+61 413 948 411",
 * "61413948411") against the E.164 form Twilio uses ("+61413948411").
 * Australian numbers are the default; anything already carrying a country
 * code is kept as it is.
 */

export function normalisePhone(raw) {
  const s = String(raw ?? '').replace(/[^\d+]/g, '')
  if (!s) return ''
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '')
  if (s.startsWith('61') && s.length >= 11) return '+' + s
  if (s.startsWith('0')) return '+61' + s.slice(1)
  return '+61' + s
}

// "+61413948411" → "0413 948 411" for display; other countries print as given.
export function formatPhone(e164) {
  const s = String(e164 ?? '')
  const m = /^\+61(\d{9})$/.exec(s)
  if (!m) return s
  const d = '0' + m[1]
  return d.startsWith('04') ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`
}
