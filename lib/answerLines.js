/*
 * How many working-out lines should a question get when the author leaves the
 * count blank?
 *
 * The old answer was a constant (3 for a part, 6 for a whole question), which
 * fit nobody: a one-line "= $600" answer got the same room as a five-step
 * derivation. The solution the author typed is the best available signal for
 * how much writing the student will do — so the default is now read off it.
 *
 * An explicitly typed count (including 0) always wins; this only replaces the
 * fallback. Kept free of imports so it can be unit-tested in plain Node and
 * shared by the renderer and the builder UI (which shows the computed number
 * as the input's placeholder).
 */

// Estimate how many printed lines the solution itself occupies.
function solutionSize(h) {
  let est = 0
  for (const raw of String(h?.solution || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // Display maths sits on its own and takes about two text lines of height.
    if (/^\$\$[^$]*\$\$$/.test(line)) { est += 2; continue }
    // LaTeX inflates character counts (\dfrac{2\,362.50}{15\,000} is a couple
    // of glyphs wide) — collapse commands and markup before judging how many
    // ~90-character printed lines the text wraps onto.
    const plain = line.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}$_^&~*]/g, '')
    est += Math.max(1, Math.ceil(plain.length / 90))
  }
  // A solution image or drawn maths object means the student reproduces a
  // diagram or graph — allow room for the drawing, not just words.
  if (h?.solutionImage) est += 4
  if (h?.solutionMathObj) est += 4
  return est
}

/**
 * The line count to use when `lines` is blank. `dflt` is the old static
 * default (3 for a part, 6 for a whole question) and still applies when there
 * is no solution to read. Handwriting runs larger than typesetting, so each
 * estimated solution line earns 1.5 writing lines — floored so short answers
 * keep usable space, capped where the author should be deciding deliberately.
 */
export function autoLines(h, dflt) {
  const est = solutionSize(h)
  if (!est) return dflt
  const floor = dflt >= 6 ? 3 : 2
  return Math.max(floor, Math.min(15, Math.round(est * 1.5)))
}
