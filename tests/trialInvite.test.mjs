/*
 * The trial invitation class picker — lib/trialInvite.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseSections, planTrialPicks, optionDetail, optionTitle, trialOfferHtml, buildTrialBookedEmailHtml } from '../lib/trialInvite.js'

const offered = [{
  submission_id: '12', label: 'Maths · Year 9',
  options: [
    { kind: 'class', class_id: 40, class_name: 'Y9 Maths', day: 'Saturday', start: '13:00:00', end: '14:30', date: '2026-10-24' },
    { kind: 'class', class_id: 40, class_name: 'Y9 Maths again', date: '2026-10-31' },   // same class twice
    { kind: 'class', class_name: 'No id', date: '2026-10-24' },                          // no class
    { kind: 'slot', date: '2026-10-25', start: '9:30', end: '10:30' },
    { kind: 'slot', date: 'Sunday', start: '9:30' },                                      // bad date
  ],
}, { submission_id: 13, options: [] }]

test('offered classes are cleaned: one per class, real dates, times as hh:mm', () => {
  const [sec, ...rest] = normaliseSections(offered)
  assert.equal(rest.length, 0, 'a request with nothing offered has no section')
  assert.equal(sec.submission_id, 12)
  assert.deepEqual(sec.options.map(o => o.id), ['c40', 's2026-10-25-09:30'])
  assert.equal(sec.options[0].start, '13:00')
  assert.equal(optionDetail(sec.options[0]), 'Saturdays · 1:00pm – 2:30pm · first lesson Saturday 24 October')
})

test('a family can only pick what was offered and is still open', () => {
  const invite = { sections: normaliseSections(offered) }
  assert.equal(planTrialPicks({ invite, picks: { 12: 'c40' }, today: '2026-10-20' }).chosen[0].option.class_id, 40)
  assert.equal(planTrialPicks({ invite, picks: {}, today: '2026-10-20' }).chosen.length, 0)
  assert.match(planTrialPicks({ invite, picks: { 12: 'c99' }, today: '2026-10-20' }).error, /no longer available/)
  assert.match(planTrialPicks({ invite, picks: { 12: 'c40' }, today: '2026-10-25' }).error, /no longer available/, 'its first lesson has passed')
  assert.match(planTrialPicks({ invite: null, picks: {} }).error, /not valid/)
})

test('the level test results email offers the classes with a button', () => {
  const sections = normaliseSections(offered)
  assert.equal(trialOfferHtml({ link: '', sections }), '')
  const html = trialOfferHtml({ link: 'https://x/trial/abc', sections, studentName: 'Luke Hong' })
  assert.match(html, /Luke’s free trial/)
  assert.match(html, /Y9 Maths/)
  assert.match(html, /href="https:\/\/x\/trial\/abc"[^>]*>Choose a trial class/)
})

test('an "other" option staff typed in: a name, with a date and time only if given', () => {
  const [sec] = normaliseSections([{ submission_id: 7, options: [
    { kind: 'slot', label: '  Y7 English 1:1 ' },
    { kind: 'slot', label: 'Y7 English 1:1 (Sat)', date: '2026-10-31', start: '14:00', end: '15:00' },
    { kind: 'slot', label: '' },                                  // nothing to show
  ] }])
  const [plain, dated] = sec.options
  assert.equal(sec.options.length, 2)
  assert.deepEqual([optionTitle(plain), optionDetail(plain)], ['Y7 English 1:1', ''])
  assert.deepEqual([optionTitle(dated), optionDetail(dated)], ['Y7 English 1:1 (Sat)', 'Saturday 31 October · 2:00pm – 3:00pm'])
  // an undated option never closes; a dated one closes once its day passes
  const invite = { sections: [sec] }
  assert.equal(planTrialPicks({ invite, picks: { 7: plain.id }, today: '2027-01-01' }).chosen[0].option.label, 'Y7 English 1:1')
  assert.match(planTrialPicks({ invite, picks: { 7: dated.id }, today: '2026-11-01' }).error, /no longer available/)
  // the emails show the name without an empty date line
  assert.match(trialOfferHtml({ link: 'https://x/t', sections: [sec] }), /<strong>Y7 English 1:1<\/strong><\/p>/)
  const booked = buildTrialBookedEmailHtml({ parentName: 'Jo', studentName: 'Sam', chosen: [{ section: sec, option: plain }] })
  assert.match(booked, /Y7 English 1:1/)
  assert.match(booked, /in touch shortly to confirm the details/)
})
