/*
 * Constrained inline formatting for Info Centre text. Admins type lightweight
 * markdown; we render a fixed, safe subset (no arbitrary HTML/styles):
 *   **bold**  *italic*  ~~strike~~  ==highlight==  `code`  [label](url)
 */
export function inlineHtml(text = '') {
  let s = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // [label](url) — internal (/path) or external (http) only
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, label, url) => {
    const ext = /^https?:/i.test(url)
    return `<a href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''} class="ih-link">${label}</a>`
  })
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')
  s = s.replace(/==(.+?)==/g, '<mark class="ih-mark">$1</mark>')
  s = s.replace(/`([^`]+?)`/g, '<code class="ih-code">$1</code>')
  return s
}

export function inlineMultiline(text = '') {
  return inlineHtml(text).replace(/\n/g, '<br/>')
}

// Convert a YouTube/Vimeo watch URL into an embeddable URL (or '' if unknown).
export function videoEmbedUrl(url = '') {
  const u = String(url).trim()
  let m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/)
  if (m) return `https://www.youtube.com/embed/${m[1]}`
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (m) return `https://player.vimeo.com/video/${m[1]}`
  return ''
}
