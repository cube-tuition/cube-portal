/*
 * Course Offers — promotional emails pitching a course to a targeted cohort
 * (e.g. Maths to English-only students, Chemistry to Year 10). Shared by the
 * /tutor/emails/course-offers page (preview) and the send route.
 *
 * Subjects are the canonical names from components/CourseDetail's inferSubject.
 */

import { FREE_TRIAL_URL } from './forms'

export const OFFER_SUBJECTS = ['Mathematics', 'English', 'Chemistry', 'Physics', 'Science']
export const OFFER_YEARS    = [3, 5, 6, 7, 8, 9, 10, 11, 12]   // no Year 4 — CUBE doesn't teach it

// Standard multi-course discount, shown as a callout after every course-offer
// email so families know the value continues once the intro discount ends.
// (Mirrors the figures in lib/discountEmail's DEFAULT_DISCOUNT_CONTENT.)
const MULTI_COURSE_NOTE = {
  heading: 'After your first discounted term',
  body: 'Once this introductory offer ends, our standard <strong>multi-course discount</strong> keeps applying — <strong>2 courses → $100 off</strong> and <strong>3 courses → $150 off</strong> your term fees — so adding a subject stays great value, term after term.',
}

export function fillOfferTemplate(text, vars = {}) {
  return (text || '')
    .replace(/\{\{parent_name\}\}/g,   vars.parentName   || 'there')
    .replace(/\{\{student_names\}\}/g, vars.studentNames || 'your child')
}

const richInline = (text, vars) => fillOfferTemplate(text || '', vars)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inlineFmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

// The call to action, as a button.
//
// "Just reply to this email" asks a parent to compose something, and a reply
// lands in a mailbox rather than in a list we work through — a form puts them
// straight into the pipeline with the details we need. Written as
// {{cta_button}} on its own line in the body, so the author chooses where it
// sits; {{trial_button}} is the older spelling and still works.
//
// Each offer names its own destination, because they don't all want the same
// action: most want a free trial, while a course with limited spots wants an
// expression of interest. Null label/url = the free-trial default.
export const DEFAULT_CTA = { label: 'Book a free trial →', url: FREE_TRIAL_URL }
const ctaButton = (cta = {}) => {
  const label = String(cta.label || '').trim() || DEFAULT_CTA.label
  const url   = String(cta.url   || '').trim() || DEFAULT_CTA.url
  return `
      <div style="text-align:center;margin:28px 0 24px;">
        <a href="${esc(url)}" style="display:inline-block;background:#062E63;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.4px;padding:14px 34px;border-radius:10px;">${esc(label)}</a>
        <p style="margin:10px 0 0;font-size:12px;color:#5b7bc4;">Takes a minute — we'll be in touch.</p>
      </div>`
}

// A light-blue callout box (the shared style for the special-offer + ongoing
// discount notes).
const noteBox = (heading, bodyHtml) => `
      <div style="margin:26px 0;background:#F0F4FF;border:1px solid #DEE7FF;border-radius:12px;padding:18px 20px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#062E63;text-transform:uppercase;letter-spacing:0.6px;">${heading}</p>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#2A2035;">${bodyHtml}</p>
      </div>`

// A line that opens with -, * or • is a dot point. Lists are written the way
// you'd write them in a plain-text email:
//
//   What the term covers:
//   - Module 1, then Module 2
//   - Weekly practice questions
//
// so a run of bullet lines becomes one <ul> and the lines around it stay
// paragraph text. Inline <ul>/<li> styles, because an email client will throw
// away a stylesheet and the defaults differ wildly between them.
const BULLET = /^\s*[-*•]\s+/

function blockHtml(block) {
  let out = ''
  let text = []
  let items = []
  const flushText = () => {
    if (!text.length) return
    out += `<p style="margin:0 0 16px 0;line-height:1.7;">${text.map(inlineFmt).join('<br/>')}</p>`
    text = []
  }
  const flushList = () => {
    if (!items.length) return
    out += `<ul style="margin:0 0 16px 0;padding-left:22px;line-height:1.7;">${
      items.map((it) => `<li style="margin:0 0 6px 0;">${inlineFmt(it)}</li>`).join('')}</ul>`
    items = []
  }
  for (const line of block.split('\n')) {
    if (BULLET.test(line)) { flushText(); items.push(line.replace(BULLET, '')) }
    else { flushList(); text.push(line) }
  }
  flushText(); flushList()
  return out
}

// Wrap the plain-text body (with {{placeholders}} and **bold**) in the CUBE
// branded email shell. `highlight` is the special-offer line, shown in a callout
// box with the ongoing-discount note. Pure function — safe on client and server.
export function buildCourseOfferEmailHtml(body, vars = {}, highlight = '', cta = {}) {
  const filled = fillOfferTemplate(body, vars)
  const hl = (highlight || '').trim()
  const specialBox = hl ? noteBox('Special offer this term', richInline(hl, vars)) : ''

  // Render the body block by block. A standalone {{special_offer}} line is where
  // the special-offer box goes (e.g. just after the short description). If the
  // marker is absent, the box falls back to after the body.
  let placed = false
  let bodyHtml = ''
  for (const block of filled.split(/\n\n+/)) {
    if (block.trim() === '{{special_offer}}') { bodyHtml += specialBox; placed = true; continue }
    if (block.trim() === '{{cta_button}}' || block.trim() === '{{trial_button}}') { bodyHtml += ctaButton(cta); continue }
    bodyHtml += blockHtml(block)
  }
  if (specialBox && !placed) bodyHtml += specialBox

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>
      <div style="font-size:15px;">${bodyHtml}</div>
      ${noteBox(MULTI_COURSE_NOTE.heading, MULTI_COURSE_NOTE.body)}
    </div>
  </body></html>`
}

// Starter body for a new offer.
export const DEFAULT_OFFER_BODY = `Hi {{parent_name}},

We've loved having {{student_names}} at CUBE, and wanted to let you know about a course we think would be a great fit.

[Write a short overview of the course here — what it covers, who teaches it, and why it helps.]

{{special_offer}}

{{cta_button}}

Kind regards,
The CUBE Team`
