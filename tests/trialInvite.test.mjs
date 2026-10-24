/*
 * The trial invitation class picker — lib/trialInvite.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseSections, planTrialPicks, optionDetail, optionTitle, trialOfferHtml, buildTrialBookedEmailHtml, otherOptions, planTrialNotes, inviteAnswer } from '../lib/trialInvite.js'

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

test('the level test results email offers the classes the way the trial invitation does, with its button', () => {
  const sections = normaliseSections(offered)
  assert.equal(trialOfferHtml({ link: '', sections }), '')
  const html = trialOfferHtml({ link: 'https://x/trial/abc', sections, studentName: 'Luke Hong' })
  assert.match(html, /Suggested trial class/)
  assert.match(html, /Based on Luke’s level test/)
  assert.match(html, /Suggested first lesson: <strong>Saturday 24 October<\/strong>/, 'the first option is suggested, with its first lesson')
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
  assert.match(trialOfferHtml({ link: 'https://x/t', sections: [sec] }), />Y7 English 1:1<\/p>\s*<\/div>/)
  const booked = buildTrialBookedEmailHtml({ parentName: 'Jo', studentName: 'Sam', chosen: [{ section: sec, option: plain }] })
  assert.match(booked, /Y7 English 1:1/)
  assert.match(booked, /in touch shortly to confirm the details/)
})

test('other options typed on the results email become offered options; unnamed ones are dropped', () => {
  const opts = otherOptions([{ label: ' Y7 Maths 1:1 ', date: '2026-11-01', start: '10:00', end: '11:00' }, { label: '  ' }, null])
  assert.deepEqual(opts, [{ kind: 'slot', label: 'Y7 Maths 1:1', date: '2026-11-01', start: '10:00', end: '11:00', note: '' }])
  assert.deepEqual(otherOptions(undefined), [])
  const sections = normaliseSections([{ submission_id: 10, label: 'Maths · Year 7', options: opts }])
  assert.match(trialOfferHtml({ link: 'https://x/t', sections }), />Y7 Maths 1:1<\/p>\s*<p[^>]*>Sunday 1 November · 10:00am – 11:00am<\/p>/)
})

test('an other option’s note shows after it in the emails and on the form', () => {
  const [sec] = normaliseSections([{ submission_id: 9, label: 'English', options: otherOptions([{ label: 'Y7 English 1:1', note: ' times can be discussed ' }]) }])
  assert.equal(optionDetail(sec.options[0]), 'times can be discussed')
  assert.match(trialOfferHtml({ link: 'https://x/t', sections: [sec] }), />Y7 English 1:1<\/p>\s*<p[^>]*>times can be discussed<\/p>/)
})

test('"none of these suit" is per subject: book English, tell us about Maths', () => {
  const sections = normaliseSections([
    { submission_id: 1, label: 'English', options: [{ kind: 'class', class_id: 5, class_name: 'Y7 English', date: '2026-10-31' }] },
    { submission_id: 2, label: 'Maths', options: [{ kind: 'class', class_id: 6, class_name: 'Y7 Maths', date: '2026-10-29' }] },
  ])
  const invite = { sections, picks: {} }
  assert.deepEqual(planTrialNotes({ invite, notes: { 2: ' Weekdays after 5pm ' } }).noted.map(n => [n.section.label, n.note]), [['Maths', 'Weekdays after 5pm']])
  assert.match(planTrialNotes({ invite, notes: { 2: '  ' } }).error, /which days and times/)
  assert.deepEqual(planTrialNotes({ invite, notes: { 99: 'x' } }).noted, [], 'not on this invite')
  // a booked subject is changed by replying, not switched to "none" here
  assert.match(planTrialNotes({ invite: { ...invite, picks: { 1: { option_id: 'c5' } } }, notes: { 1: 'x' } }).error, /already booked/)

  const answered = { ...invite, responded_at: '2026-10-24', picks: { 1: { option_id: 'c5' }, 2: { none: true, note: 'Weekdays after 5pm' } } }
  assert.deepEqual(inviteAnswer(answered, 1), { pick: sections[0].options[0], note: '' })
  assert.deepEqual(inviteAnswer(answered, 2), { pick: null, note: 'Weekdays after 5pm' })
  // an older form's one note covers whatever wasn't picked
  assert.deepEqual(inviteAnswer({ sections, picks: {}, responded_at: 'x', note: 'Sundays' }, 2), { pick: null, note: 'Sundays' })

  const html = buildTrialBookedEmailHtml({ parentName: 'Yoon', studentName: 'Luke Hong',
    chosen: [{ section: sections[0], option: sections[0].options[0] }], noted: [{ section: sections[1], note: 'x' }] })
  assert.match(html, /Y7 English/)
  assert.match(html, /For Maths, thanks for letting us know what suits — we’ll be in touch with a time/)
})

test('the pipeline invitation mentions an attached level test report and suggests from the test', async () => {
  const { buildTrialInvitationEmailHtml } = await import('../lib/trialInvitationEmail.js')
  const proposal = { className: 'Y7 English', day: 'Saturday', time: '1:00pm – 2:30pm', date: 'Sat 31 Oct' }
  const plain = buildTrialInvitationEmailHtml({ studentName: 'Luke' }, proposal, [], {}, null, '#')
  assert.doesNotMatch(plain, /level test/)
  const one = buildTrialInvitationEmailHtml({ studentName: 'Luke' }, proposal, [], {}, null, '#', { levelTest: 1 })
  assert.match(one, /Thank you for bringing Luke to the level test — the report is attached/)
  assert.match(one, /Based on Luke’s level test/)
  const two = buildTrialInvitationEmailHtml({ studentName: 'Luke and Mia' }, proposal, [], {}, null, '#', { levelTest: 2 })
  assert.match(two, /the reports are attached/)
})
