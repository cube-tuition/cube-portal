import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syllabusPlainText, dotpointAsSubtopic } from '../lib/syllabusPlain.js'

test('syllabus formulas read as plain text', () => {
  assert.equal(syllabusPlainText('deduce the equilibrium expression (in terms of $K_{eq}$)'), 'deduce the equilibrium expression (in terms of Keq)')
  assert.equal(syllabusPlainText('$Ca^{2+}$, $CO_3^{2-}$, $PO_4^{3-}$ and $Ag^+$'), 'Ca²⁺, CO₃²⁻, PO₄³⁻ and Ag⁺')
  assert.equal(syllabusPlainText('$[H^+]$ and $[OH^-]$ in $H_2O$'), '[H⁺] and [OH⁻] in H₂O')
  assert.equal(syllabusPlainText('using $\\Delta G = \\Delta H - T\\Delta S$'), 'using ΔG = ΔH − TΔS')
  assert.equal(syllabusPlainText('$q = mc\\Delta T$'), 'q = mcΔT')
  assert.equal(syllabusPlainText('no maths here'), 'no maths here')
})

test('a dot point becomes one inquiry question, examples indented beneath', () => {
  assert.equal(dotpointAsSubtopic('analyse examples, for example:', ['combustion reactions', 'photosynthesis']),
    'analyse examples, for example:\n    – combustion reactions\n    – photosynthesis')
  assert.equal(dotpointAsSubtopic('explain $K_{sp}$'), 'explain Ksp')
})
