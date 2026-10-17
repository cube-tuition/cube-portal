/*
 * Syllabus text as plain readable text — for places that show a dot point as
 * a label rather than rendering maths (the Topics page, question-bank filters).
 * The master syllabus writes formulas as LaTeX: "$K_{eq}$", "$Ca^{2+}$",
 * "$\Delta G = \Delta H - T\Delta S$". Here they become Keq, Ca²⁺ and
 * ΔG = ΔH − TΔS. Pure.
 */
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻' }
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋' }
// Digits and signs have true sub/superscript characters; letters (eq, sp) stay plain.
const mapChars = (s, table) => [...s].map(ch => table[ch] ?? ch).join('')

function plainMaths(tex) {
  return tex
    .replace(/\\Delta\s?/g, 'Δ')
    .replace(/\\(?:times|cdot)/g, '×')
    .replace(/_\{([^}]*)\}|_(\S)/g, (_, a, b) => mapChars(a ?? b, SUB))
    .replace(/\^\{([^}]*)\}|\^(\S)/g, (_, a, b) => mapChars(a ?? b, SUP))
    .replace(/ - /g, ' − ')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
}

export function syllabusPlainText(text) {
  return String(text ?? '').replace(/\$([^$]+)\$/g, (_, tex) => plainMaths(tex))
}

// One question-bank inquiry question: the dot point, then its examples on
// indented "–" lines (the format the Topics page writes by hand).
export function dotpointAsSubtopic(main, subs = []) {
  return [syllabusPlainText(main), ...subs.map(s => `    – ${syllabusPlainText(s)}`)].join('\n')
}
