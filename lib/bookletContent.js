/*
 * Booklet "content" summary text — the short per-booklet outline shown in the
 * curriculum/workbook "Booklet content" modals.
 *
 * For Chemistry booklets it's generated from each section header's drawn syllabus
 * dotpoints (section header + its • main dotpoints / — subdotpoints), so the modal
 * mirrors the new per-section syllabus system. For other subjects it stays the
 * free-text summary the tutor typed.
 */

// Build the content text from a booklet's section blocks (drawn dotpoints).
// Format: a plain header line per section, then "• main" and "  — sub" lines.
export function buildSyllabusContent(blocks) {
  const out = []
  for (const b of blocks || []) {
    if (b.type !== 'section') continue
    const header = [b.number, b.title].map(v => String(v ?? '').trim()).filter(Boolean).join('. ')
    const lines = String(b.syllabus || '').split('\n')
      .map(l => ({ sub: /^\s/.test(l), text: l.replace(/^\s*[-•—]\s*/, '').trim() }))
      .filter(l => l.text)
    if (!header && !lines.length) continue
    if (header) out.push(header)
    for (const l of lines) out.push(l.sub ? `  — ${l.text}` : `• ${l.text}`)
  }
  return out.join('\n')
}

// Parse content text into renderable rows: { kind: 'header'|'main'|'sub', text }.
// A "• " line is a main dotpoint, an indented "— "/"- " line is a subdotpoint,
// anything else is a section header.
export function parseBookletContent(text) {
  const rows = []
  for (const raw of String(text || '').split('\n')) {
    const t = raw.replace(/\s+$/, '')
    if (!t.trim()) continue
    if (/^\s*•\s+/.test(t)) rows.push({ kind: 'main', text: t.replace(/^\s*•\s+/, '') })
    else if (/^\s+[—-]\s+/.test(t) || /^[—]\s+/.test(t)) rows.push({ kind: 'sub', text: t.replace(/^\s*[—-]\s+/, '') })
    else rows.push({ kind: 'header', text: t.trim() })
  }
  return rows
}
