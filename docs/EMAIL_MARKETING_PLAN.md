# CUBE Tuition — Email Marketing Plan
**Updated:** 2026-06-12 · Sent via the portal Emails hub (Resend)

## Goal
Grow enrolments through referrals (the cheapest acquisition channel a tutoring centre has) and lift revenue per family via multi-course and sibling enrolments — without spamming a small, high-trust parent list.

## Audience
One email per **family** (deduped by family number), guardians of **active** students only. Trial-pipeline parents are deliberately excluded from discount marketing — they get the trial follow-up sequence instead, and discounts are mentioned at conversion time by the director.

## The cadence (per 10-week term)

| When | Email | Purpose | Page |
|---|---|---|---|
| Week 0 (term start) | Term Start / re-enrolment confirmation | Confirm classes + invoice. **Add one line:** "Ask us about referral & sibling discounts." | /tutor/emails/term-start |
| **Week 2** | **Discount Program** (this campaign) | Families are settled, invoices are paid — the moment they're most likely to recommend CUBE. Referral-led. | /tutor/emails/discount-program |
| Week 7–8 | Re-enrolment reminder | Re-enrol for next term; restate multi-course discount ("adding a second subject saves $100"). | /tutor/emails/term-start |
| Week 10 | End-of-Term Reports | Reports attached; goodwill peak. PS line: "Know a family who'd benefit? You both get $50 off." | /tutor/emails/end-of-term |
| New family enrols | Welcome email | Include the referral one-liner from day one. | manual |

Rules of thumb: never send the discount email in the same week as an invoice; max one marketing email per term (the rest are transactional with a one-line nudge); always test-send first.

## Message architecture (Discount Program email)
1. **Hero — Referral Program**: "$50 off — for both families", unlimited, 3-step how-it-works. This is the growth lever; it gets the headline, the card, and the CTA.
2. **Secondary — Multi-Course ($100/2, $150/3) and Sibling ($50 each)**: revenue-per-family boosters, shown as equal twin cards.
3. **Good-to-know box**: the PDF's fine print (enrolment required, new families only, credit carry-forward, paid-term handling) — trust through transparency.
4. **CTA**: reply-to-email referral ("just reply with the student's name") — lowest possible friction; no forms to build.

## Measurement (already in the portal)
- `referrals` table + invoice `sibling_discount` / `multi_course_discount` columns show uptake directly.
- Compare trial submissions with a "Referred by" value before vs after each send.
- Target: 2–3 referred trials within 2 weeks of each send. If a send produces zero, change the subject line before blaming the offer.

## Future ideas (not built)
- Auto-include a "you have $X referral credit" line in invoice emails.
- A referral leaderboard/thank-you note at end of year for top referring families.
- Track sends per family in a `comm_log` table → feeds the Families view "Last Conversation" placeholder.
