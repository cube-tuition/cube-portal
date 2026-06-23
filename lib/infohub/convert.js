import { newBlock } from './blocks'

/*
 * Convert the legacy single-field markdown (## / ### / - / 1. / --- / paragraphs)
 * used by the old Info pages into the new block array. Inline markers
 * (**bold**, *italic*, `code`, [link](url)) are preserved verbatim — the new
 * inline renderer understands the same syntax.
 */
export function mdToBlocks(md = '') {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let para = []
  const flushPara = () => {
    if (para.length) { blocks.push({ ...newBlock('paragraph'), text: para.join('\n').trim() }); para = [] }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (t === '') { flushPara(); i++; continue }
    if (/^---+$/.test(t)) { flushPara(); blocks.push(newBlock('divider')); i++; continue }
    if (/^###\s+/.test(t)) { flushPara(); blocks.push({ ...newBlock('heading'), level: 3, text: t.replace(/^###\s+/, '') }); i++; continue }
    if (/^##\s+/.test(t)) { flushPara(); blocks.push({ ...newBlock('heading'), level: 2, text: t.replace(/^##\s+/, '') }); i++; continue }
    if (/^#\s+/.test(t)) { flushPara(); blocks.push({ ...newBlock('heading'), level: 2, text: t.replace(/^#\s+/, '') }); i++; continue }
    // Bulleted list run
    if (/^[-*]\s+/.test(t)) {
      flushPara()
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++ }
      blocks.push({ ...newBlock('bulleted'), items })
      continue
    }
    // Numbered list run
    if (/^\d+[.)]\s+/.test(t)) {
      flushPara()
      const items = []
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++ }
      blocks.push({ ...newBlock('numbered'), items })
      continue
    }
    para.push(line)
    i++
  }
  flushPara()
  return blocks.length ? blocks : [{ ...newBlock('paragraph'), text: '' }]
}
