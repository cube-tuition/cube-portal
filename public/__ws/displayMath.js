/*
 * A $$…$$ block is allowed to span several source lines — an array, a matrix,
 * a multi-line derivation, a proof written one step per line.
 *
 * Both rich-text renderers (components/qbank/LatexContent.js richToHtml, and
 * lib/bookletRender.js rich) split their input on newlines and format one line
 * at a time, so an author who pressed Enter inside $$…$$ was handing KaTeX half
 * a block. It rendered as raw LaTeX source with no error anywhere — which is
 * exactly how it reached a printed worksheet.
 *
 * Rejoining the block before the line loop fixes it for both. The joined text
 * keeps its newlines: KaTeX treats them as whitespace, and latexToHtml scans
 * the string rather than working line by line, so nothing else has to change.
 *
 * An escaped \$ is a literal dollar sign and can never open or close a block.
 */
export function joinDisplayMath(lines) {
  const out = []
  let open = null
  for (const line of lines) {
    const delims = (String(line).replace(/\\\$/g, '').match(/\$\$/g) || []).length
    if (open === null) {
      if (delims % 2) open = line          // block opened and not closed here
      else out.push(line)
    } else {
      open += '\n' + line
      if (delims % 2) { out.push(open); open = null }   // and now it closes
    }
  }
  // An unterminated block is a typo; pass it through so it still shows up
  // rather than vanishing.
  if (open !== null) out.push(open)
  return out
}
