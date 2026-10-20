'use client'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import { fmtDate, isoDate } from '../../../lib/format'
import { registerUndoAction } from '../../../lib/undo'
import { HOW_HEARD_CHANNELS, HOW_HEARD_COLORS, HOW_HEARD_UNKNOWN_COLOR, channelStats } from '../../../lib/howHeard'
import { fetchAllTerms, getEnrolmentTerm } from '../../../lib/terms'
import { classesForTerm, classesAllTerms } from '../../../lib/classes'
import { logReferralWithCredits } from '../../../lib/referralCredits'
import SearchSelectPopover from '../../../components/SearchSelectPopover'
import TrialOutcomeModal from '../../../components/trials/TrialOutcomeModal'
import TrialInvitationModal from '../../../components/trials/TrialInvitationModal'
import LevelTestInvitationModal from '../../../components/trials/LevelTestInvitationModal'
import PipelineFlow from '../../../components/trials/PipelineFlow'
import { nextStep, trialStage, ACTION_BUTTON } from '../../../lib/trialNextStep'
import { earliestTrialStart, trialDatesFor } from '../../../lib/trialDates'

// Students who can be picked as a referrer (an enrolled CUBE family member).
const REFERRER_EXCLUDED_STATUSES = ['quit', 'quit trial', 'disenrolled', 'declined']

// A standard CUBE trial is two lessons per subject. Used for the progress badge
// only — nothing is enforced; staff decide when a trial is done.
const TRIAL_LESSONS = 2

// Group students into <optgroup> buckets: proper families (shared family_id)
// first, then family-less students individually.
function referrerGroups(students) {
  const fams = new Map(), singles = []
  for (const s of students) {
    if (s.family_id != null) {
      if (!fams.has(s.family_id)) fams.set(s.family_id, [])
      fams.get(s.family_id).push(s)
    } else singles.push(s)
  }
  const famGroups = [...fams.entries()].map(([familyId, members]) => {
    const surname = (members[0].full_name || '').trim().split(' ').slice(-1)[0]
    return { familyId, label: `${surname} family`, members }
  }).sort((a, b) => a.label.localeCompare(b.label) || (a.familyId - b.familyId))
  // Same surname twice (two unrelated Kim families): append first names so the
  // admin can tell them apart, e.g. "Kim family (Samuel, Emily)".
  const labelCount = {}
  for (const g of famGroups) labelCount[g.label] = (labelCount[g.label] || 0) + 1
  for (const g of famGroups) {
    if (labelCount[g.label] > 1) {
      const firsts = g.members.map(m => (m.full_name || '').trim().split(' ')[0]).filter(Boolean).join(', ')
      g.label = `${g.label} (${firsts})`
    }
  }
  return { famGroups, singles: singles.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')) }
}

// ── Channel insights — where enquiries come from & what converts ──────────────
function ChannelInsights({ submissions }) {
  const [range, setRange] = useState('all')   // 'all' | '90' | '365'
  const [open, setOpen] = useState(true)
  const cutoff = range === 'all' ? null : Date.now() - Number(range) * 86400000
  const inRange = cutoff ? submissions.filter(s => s.submitted_at && new Date(s.submitted_at).getTime() >= cutoff) : submissions
  const stats = channelStats(inRange)
  const totals = stats.reduce((a, r) => ({ enquiries: a.enquiries + r.enquiries, converted: a.converted + r.converted }), { enquiries: 0, converted: 0 })
  const maxEnq = Math.max(1, ...stats.map(r => r.enquiries))

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-2xl mb-6 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#F8FAFF] transition">
        <span className="text-sm font-bold text-[#062E63]">📊 Where enquiries come from
          <span className="font-normal text-[#2A2035]/40 ml-2 text-xs">
            {totals.enquiries} enquir{totals.enquiries === 1 ? 'y' : 'ies'} · {totals.converted} enrolled
            {totals.enquiries > 0 && ` · ${Math.round((totals.converted / totals.enquiries) * 100)}% conversion`}
          </span>
        </span>
        <span className="text-[#325099] text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-[#DEE7FF] px-5 py-4">
          <div className="flex items-center gap-1.5 mb-4">
            {[['all', 'All time'], ['365', 'Last 12 months'], ['90', 'Last 90 days']].map(([v, l]) => (
              <button key={v} onClick={() => setRange(v)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition ${range === v ? 'bg-[#325099] text-white border-[#325099]' : 'text-[#325099] border-[#DEE7FF] hover:bg-[#F0F4FF]'}`}>
                {l}
              </button>
            ))}
          </div>
          {stats.length === 0 ? (
            <p className="text-xs text-[#2A2035]/40 py-2">No enquiries in this period yet. Channels are recorded automatically from the website form, or set them on each card below.</p>
          ) : (
            <div className="space-y-2">
              {stats.map(r => (
                <div key={r.channel} className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full w-44 shrink-0 text-center truncate ${HOW_HEARD_COLORS[r.channel] ?? HOW_HEARD_UNKNOWN_COLOR}`}>{r.channel}</span>
                  <div className="flex-1 h-4 bg-[#F0F4FF] rounded-full overflow-hidden">
                    <div className="h-full bg-[#325099] rounded-full transition-all" style={{ width: `${(r.enquiries / maxEnq) * 100}%`, minWidth: 6 }} />
                  </div>
                  <span className="text-[11px] text-[#2A2035]/70 w-40 shrink-0 tabular-nums">
                    {r.enquiries} enquir{r.enquiries === 1 ? 'y' : 'ies'} · <strong className="text-emerald-700">{r.converted} enrolled</strong> ({r.rate}%)
                  </span>
                </div>
              ))}
              <p className="text-[10px] text-[#2A2035]/35 pt-2">Conversion = enquiries that became enrolled students. &ldquo;Not recorded&rdquo; rows can be fixed by setting the channel on each card.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Status pipeline ───────────────────────────────────────────────────────────
const STAGES = [
  { id: 'new',             label: 'New',             color: 'bg-amber-100 text-amber-800 border-amber-200',   dot: 'bg-amber-400' },
  { id: 'contacted',       label: 'Contacted',        color: 'bg-blue-100 text-blue-800 border-blue-200',      dot: 'bg-blue-400'  },
  { id: 'trial_scheduled', label: 'Trial Scheduled',  color: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-400' },
  // The two trial lessons. Each moves on by itself when the tutor marks the
  // roll with trial feedback (migrations/20261020_trial_lesson_progress.sql).
  { id: 'trial_1_completed', label: 'Trial 1/2 Completed', color: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-400' },
  { id: 'trial_completed', label: 'Trial 2/2 Completed',  color: 'bg-indigo-100 text-indigo-800 border-indigo-200', dot: 'bg-indigo-400' },
  // Paused by the family ("we'll hold off for now"): off the active list and
  // the nudges, trial enrolment ended, reopened by setting another stage.
  { id: 'on_hold',         label: 'On hold',          color: 'bg-slate-100 text-slate-600 border-slate-300',    dot: 'bg-slate-400' },
  { id: 'enrolled',        label: 'Enrolled',         color: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-400' },
  { id: 'declined',        label: 'Declined',         color: 'bg-gray-100 text-gray-500 border-gray-200',      dot: 'bg-gray-300'  },
]

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]))

function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ submissions }) {
  const total     = submissions.length
  const newCount  = submissions.filter(s => s.status === 'new').length
  const enrolled  = submissions.filter(s => s.status === 'enrolled').length
  const rate      = total > 0 ? Math.round((enrolled / total) * 100) : 0
  const stale     = submissions.filter(s =>
    ['new','contacted'].includes(s.status) && daysSince(s.submitted_at) > 7
  ).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {[
        { label: 'Total submissions', value: total,          color: 'text-[#062E63]' },
        { label: 'New (unactioned)',   value: newCount,       color: newCount > 0 ? 'text-amber-600' : 'text-[#062E63]' },
        { label: 'Enrolled',           value: enrolled,       color: 'text-emerald-600' },
        { label: 'Conversion rate',    value: rate + '%',     color: rate >= 50 ? 'text-emerald-600' : 'text-[#062E63]' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3">
          <p className="text-[11px] text-[#325099]/50 mb-0.5">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      ))}
      {stale > 0 && (
        <div className="col-span-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-center gap-2">
          <span className="text-amber-600 text-sm font-semibold">⚠ {stale} submission{stale > 1 ? 's' : ''} unactioned for 7+ days</span>
        </div>
      )}
    </div>
  )
}

// ── Trial card ────────────────────────────────────────────────────────────────
// A class's regular lesson dates from `from` on (today by default), cancelled
// ones left out — the dates a trial can start on.
async function lessonDatesFrom(classId, from = isoDate(new Date())) {
  const { data } = await supabase.from('lessons').select('lesson_date')
    .eq('class_id', classId).eq('is_makeup', false).neq('status', 'cancelled')
    .gte('lesson_date', from).order('lesson_date', { ascending: true }).limit(30)
  return [...new Set((data || []).map(l => l.lesson_date))]
}
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
// A booked level test on the card: "Sat 25 Oct, 10am".
const fmtLevelTest = ({ date, start }) => {
  const [h, m] = String(start || '').split(':').map(Number)
  const time = Number.isFinite(h) ? `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}` : ''
  return [fmtDay(date), time].filter(Boolean).join(', ')
}

// The first trial lesson, chosen from the class's upcoming lessons. Students
// can start the same class on different weeks; the trial then covers that
// lesson and the next one (trialDatesFor), which is what the roll, the trial
// reminder and the pipeline nudges all read from enrolments.trial_start_date.
function TrialStartPicker({ classId, value, onChange }) {
  const [dates, setDates] = useState(null)
  const today = isoDate(new Date())
  const from = value && value < today ? value : today
  useEffect(() => {
    let live = true
    lessonDatesFrom(classId, from).then(d => { if (live) setDates(d) })
    return () => { live = false }
  }, [classId, from])
  if (!dates) return null
  const upcoming = dates.filter(d => d >= today)
  const opts = [...new Set([...(value ? [value] : []), ...upcoming])].sort()
  const trial = value ? trialDatesFor(dates, value) : []
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-[#325099]/60">First trial</label>
      <select
        value={value || ''}
        onChange={e => e.target.value && onChange(e.target.value)}
        className="text-xs border border-[#DEE7FF] rounded-full px-3 py-1.5 bg-white text-[#062E63] focus:outline-none focus:border-[#325099]"
        title="The first trial lesson — the trial covers this lesson and the next one"
      >
        {!value && <option value="">Choose a lesson…</option>}
        {opts.map(d => (
          <option key={d} value={d}>
            {fmtDay(d)}{d === upcoming[0] ? ' · earliest' : ''}{d < today ? ' · started' : ''}{!dates.includes(d) ? ' · no lesson that day' : ''}
          </option>
        ))}
      </select>
      {trial.length > 0 && (
        <span className="text-[10px] text-[#325099]/60">Trial lessons: {trial.map(fmtDay).join(' & ')}</span>
      )}
      {upcoming.length === 0 && <span className="text-[10px] text-[#B45309]">No upcoming lessons in this class yet</span>}
    </span>
  )
}

// The family-level badges: emails that go to the family once, whatever the
// number of subjects (the invitation covers every subject in one email).
function FamilyBadges({ sub }) {
  return (
    <>
    {/* The family has been sent the trial invitation — dated from the first send. */}
    {sub.invitation_sent_at && (
      <span
        className="text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full"
        title={`Trial invitation emailed ${fmtDate(sub.invitation_sent_at)}`}
      >
        ✉ Invited {fmtDate(sub.invitation_sent_at)}
      </span>
    )}
    {/* Invited to a level test first — and what the family answered on the form. */}
    {sub.level_test_invitation_sent_at && !sub._levelTest?.booked && !sub._levelTest?.note && (
      <span
        className="text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full"
        title={`Level test invitation emailed ${fmtDate(sub.level_test_invitation_sent_at)} — no time picked yet`}
      >
        ✉ Level test invited {fmtDate(sub.level_test_invitation_sent_at)}
      </span>
    )}
    {sub._levelTest?.booked && (
      <span
        className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"
        title="The family booked this on the level test form — it's on Monitoring → Level tests"
      >
        📝 Level test {fmtLevelTest(sub._levelTest.booked)}
      </span>
    )}
    {sub._levelTest?.note && (
      <span
        className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full max-w-[22rem] truncate"
        title={`None of the level test times suited. They said: ${sub._levelTest.note}`}
      >
        📝 Level test: other times — “{sub._levelTest.note}”
      </span>
    )}
    </>
  )
}

// Emails tied to one subject's trial class: the reminder and the feedback.
function SubjectBadges({ sub }) {
  return (
    <>
    {/* …the trial reminder (sent automatically the day before) — first send. */}
    {sub.reminder_sent_at && (
      <span
        className="text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full"
        title={`Trial reminder emailed ${fmtDate(sub.reminder_sent_at)}`}
      >
        ✉ Reminded {fmtDate(sub.reminder_sent_at)}
      </span>
    )}
    {/* …the feedback emails after each trial lesson — first-send dates too. */}
    {sub.lesson1_feedback_sent_at && (
      <span
        className="text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full"
        title={`Lesson 1 feedback emailed ${fmtDate(sub.lesson1_feedback_sent_at)}`}
      >
        ✉ Lesson 1 feedback {fmtDate(sub.lesson1_feedback_sent_at)}
      </span>
    )}
    {sub.outcome_sent_at && (
      <span
        className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"
        title={`Trial outcome emailed ${fmtDate(sub.outcome_sent_at)}`}
      >
        ✉ Outcome sent {fmtDate(sub.outcome_sent_at)}
      </span>
    )}
    </>
  )
}

function ProgressBadge({ progress }) {
  return (
    <>
    {/* Trial progress, counted per subject: green only once EVERY
        trialled subject has had its lessons. Hover for the split. */}
    {progress?.lessons > 0 && (
      <span
        className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded-full ${
          progress.lessons >= TRIAL_LESSONS
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-[#325099] bg-[#F0F4FF] border-[#DEE7FF]'}`}
        title={progress.subjects > 1
          ? `Trial lessons per subject — ${progress.breakdown}`
          : `${progress.lessons} of ${TRIAL_LESSONS} trial lessons attended`}
      >
        {progress.lessons}/{TRIAL_LESSONS} lesson{progress.lessons === 1 ? '' : 's'}
        {progress.subjects > 1 && ` · ${progress.subjects} subjects`}
      </span>
    )}
    </>
  )
}

// The stage, set by hand (a phone call is contact too). Emails sent from the
// card still stamp their own dates; Enrolled and Declined stay behind
// Convert / Drop, which also move enrolments.
function StageSelect({ status, onChange }) {
  const stage = STAGE_MAP[status] || STAGE_MAP.new
  if (['enrolled', 'declined'].includes(status)) {
    return <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full ${stage.color}`}>{stage.label}</span>
  }
  return (
    <select
      value={status}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)}
      title="Set the stage by hand — e.g. after a phone call"
      className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full cursor-pointer appearance-none pr-5 bg-no-repeat bg-[length:10px] bg-[right_6px_center] ${stage.color}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5l3 3 3-3' fill='none' stroke='%23555' stroke-width='1.5'/%3E%3C/svg%3E\")" }}
    >
      {STAGES.filter(st => !['enrolled', 'declined'].includes(st.id)).map(st => (
        <option key={st.id} value={st.id}>{st.label}</option>
      ))}
    </select>
  )
}

// Move every open subject in `subs` to `next`. Marking Contacted by hand
// records first contact, like a sent invitation does.
async function setStage(subs, next, onUpdate) {
  const open = subs.filter(s => !['enrolled', 'declined'].includes(s.status))
  const now = new Date().toISOString()
  for (const s of open) onUpdate(s.id, { status: next, ...(next === 'contacted' && !s.contacted_at ? { contacted_at: now } : {}) })
  const { error } = await supabase.from('trial_submissions').update({ status: next }).in('id', open.map(s => s.id))
  // Reopened: the hold and its check-back date go.
  const held = open.filter(s => s.status === 'on_hold' && next !== 'on_hold')
  if (!error && held.length) {
    const clear = { held_at: null, hold_until: null, hold_notified_at: null }
    await supabase.from('trial_submissions').update(clear).in('id', held.map(s => s.id))
    for (const s of held) onUpdate(s.id, clear)
  }
  if (!error && next === 'contacted') {
    await supabase.from('trial_submissions').update({ contacted_at: now }).in('id', open.map(s => s.id)).is('contacted_at', null)
  }
  if (error) {
    alert('Could not change the stage: ' + error.message)
    for (const s of open) onUpdate(s.id, { status: s.status, contacted_at: s.contacted_at ?? null })
  }
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

/*
 * Put a student's open subjects on hold. Each trial enrolment is ended (so
 * they are off the class roll and the trial reminders) and the submission
 * forgets its class — reopening starts the scheduling afresh. The student
 * goes back to pending unless they still attend or trial something else.
 * An optional note is added to the admin notes with the date.
 */
async function putOnHold(subs, { holdUntil, note }, onUpdate, onReload) {
  const open = subs.filter(s => !['enrolled', 'declined'].includes(s.status))
  if (!open.length) return
  const now = new Date().toISOString()
  const today = isoDate(new Date())
  for (const s of open) {
    if (s.converted_student_id && s.trial_class_id != null) {
      let q = supabase.from('enrolments').update({ status: 'disenrol', ended_at: today, end_reason: 'Trial on hold' })
      q = s.enrolment_id ? q.eq('id', s.enrolment_id) : q.eq('student_id', s.converted_student_id).eq('class_id', s.trial_class_id)
      const { error } = await q.in('status', ['trial', 'trial complete'])
      if (error) { alert('Could not end the trial enrolment: ' + error.message); return }
    }
    const notes = note?.trim()
      ? [s.admin_notes?.trim(), `On hold (${fmtDate(now)}): ${note.trim()}`].filter(Boolean).join('\n')
      : (s.admin_notes ?? null)
    const patch = {
      status: 'on_hold', held_at: s.status === 'on_hold' ? (s.held_at || now) : now,
      hold_until: holdUntil || null, hold_notified_at: null,
      trial_class_id: null, enrolment_id: null, admin_notes: notes,
    }
    const { error } = await supabase.from('trial_submissions').update(patch).eq('id', s.id)
    if (error) { alert('Could not put the trial on hold: ' + error.message); return }
    onUpdate(s.id, { ...patch, _trialStart: null })
  }
  for (const sid of [...new Set(open.map(s => s.converted_student_id).filter(Boolean))]) {
    const { data: still } = await supabase.from('enrolments').select('id').eq('student_id', sid).in('status', ['active', 'trial', 'trial complete']).limit(1)
    if (!still?.length) await supabase.from('students').update({ status: 'pending' }).eq('id', sid).in('status', ['trial', 'pending'])
  }
  onReload()
}

// When to check back in with a family that has put their trial on hold.
function HoldDialog({ subs, nextTermStart, onClose, onUpdate, onReload }) {
  const today = isoDate(new Date())
  const current = subs.find(s => s.status === 'on_hold')
  const [until, setUntil] = useState(current ? (current.hold_until || '') : addDays(today, 28))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const name = subs[0]?.student_name || 'this student'
  const chips = [
    { label: '2 weeks', value: addDays(today, 14) },
    { label: '4 weeks', value: addDays(today, 28) },
    ...(nextTermStart ? [{ label: 'Start of next term', value: nextTermStart }] : []),
    { label: 'No date', value: '' },
  ]
  const hasClass = subs.some(s => s.trial_class_id != null && !['enrolled', 'declined'].includes(s.status))
  const save = async () => {
    setSaving(true)
    await putOnHold(subs, { holdUntil: until, note }, onUpdate, onReload)
    setSaving(false)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <p className="text-[10px] tracking-widest uppercase font-bold text-[#325099]/60 mb-0.5">{current ? 'On hold' : 'Put on hold'}</p>
          <h2 className="text-sm font-bold text-[#062E63]">{name}</h2>
          <p className="text-xs text-[#2A2035]/60 mt-1">
            The card leaves the active list and stops sending nudges.
            {hasClass && ' The trial class is released, so they come off its roll.'}
            {' '}Set another stage on the card to reopen it.
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[#325099]/70 mb-1.5">Check back in on</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {chips.map(c => (
              <button key={c.label} onClick={() => setUntil(c.value)}
                className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${until === c.value ? 'bg-[#062E63] text-white border-[#062E63]' : 'border-[#DEE7FF] text-[#325099] hover:border-[#325099]'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <input type="date" value={until} min={today} onChange={e => setUntil(e.target.value)}
            className="text-xs border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-[#062E63] focus:outline-none focus:border-[#325099]" />
          <p className="text-[10px] text-[#325099]/50 mt-1">
            {until ? `That morning the directors get a reminder to get back in touch (${fmtDay(until)}).` : 'No reminder — it stays on hold until someone reopens it.'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[#325099]/70 mb-1.5">Note <span className="font-normal text-[#325099]/40">(added to the admin notes)</span></p>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="e.g. Mum is holding off for now — may contact us again later"
            className="w-full text-xs border border-[#DEE7FF] rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#325099]" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs text-[#325099]/60 hover:text-[#325099] px-3 py-1.5">Cancel</button>
          <button onClick={save} disabled={saving}
            className="text-xs font-semibold bg-[#062E63] text-white px-4 py-1.5 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
            {saving ? 'Saving…' : current ? 'Save' : 'Put on hold'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The badge on a held card — click to change the check-back date.
function HoldBadge({ sub, onClick }) {
  const due = sub.hold_until && sub.hold_until <= isoDate(new Date())
  return (
    <button onClick={onClick}
      className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded-full transition ${due ? 'text-amber-700 bg-amber-50 border-amber-300' : 'text-slate-600 bg-slate-50 border-slate-200 hover:border-slate-400'}`}
      title={`On hold since ${fmtDate(sub.held_at)} — click to change the check-back date`}>
      ⏸ {sub.hold_until ? `${due ? 'Check back in — due' : 'Check back'} ${fmtDay(sub.hold_until)}` : 'On hold'}
    </button>
  )
}

// The student's details, how they heard, the referrer and the admin notes.
// One student, so a grouped card writes these to every subject's submission.
function StudentDetails({ sub, subs, status, students, onUpdate, grouped = false }) {
  const [editNotes, setEditNotes] = useState(false)
  // Notes typed on separate subject cards before they were grouped are kept:
  // the distinct ones are joined and saved back to every subject.
  const initialNotes = [...new Set(subs.map(s => (s.admin_notes || '').trim()).filter(Boolean))].join('\n\n')
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [refPicker, setRefPicker] = useState(null) // { rect } → referrer popover open
  const age = daysSince(sub.submitted_at)
  const ids = subs.map(s => s.id)

  const writeAll = async (patch) => {
    await supabase.from('trial_submissions').update(patch).in('id', ids)
    for (const id of ids) onUpdate(id, patch)
  }
  const saveNotes = async () => {
    setSaving(true)
    await writeAll({ admin_notes: notes })
    setSaving(false)
    setEditNotes(false)
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-[#325099]/70">
        <div><span className="font-semibold">School:</span> {sub.school || '—'}</div>
        <div><span className="font-semibold">Day pref:</span> {sub.day_preference || '—'}</div>
        <div><span className="font-semibold">Time pref:</span> {sub.time_preference || '—'}</div>
        <div><span className="font-semibold">Submitted:</span> {fmtDate(sub.submitted_at)} ({age}d ago)</div>
        <div><span className="font-semibold">Invitation sent:</span> {sub.invitation_sent_at ? fmtDate(sub.invitation_sent_at) : '—'}</div>
        <div><span className="font-semibold">Level test invitation:</span> {sub.level_test_invitation_sent_at ? fmtDate(sub.level_test_invitation_sent_at) : '—'}</div>
        {/* per subject on a grouped card — shown in each subject's tab */}
        {!grouped && <div><span className="font-semibold">Reminder sent:</span> {sub.reminder_sent_at ? fmtDate(sub.reminder_sent_at) : '—'}</div>}
        {/* The first trial lesson lives on the enrolment (set with the First
            trial picker beside the class); trial_submissions.trial_date is
            never filled in. */}
        {!grouped && <div><span className="font-semibold">First trial lesson:</span> {sub._trialStart ? fmtDay(sub._trialStart) : (sub.trial_date ? fmtDate(sub.trial_date) : '—')}</div>}
        <div><span className="font-semibold">Source:</span> {sub.source || '—'}</div>
        <div className="col-span-full flex items-center gap-2 flex-wrap">
          <span className="font-semibold">How heard:</span>
          <select
            value={HOW_HEARD_CHANNELS.includes(sub.how_heard) ? sub.how_heard : (sub.how_heard ? 'Other' : '')}
            onChange={async e => {
              const v = e.target.value || null
              const prev = sub.how_heard ?? null
              await writeAll({ how_heard: v })
              registerUndoAction('how-heard channel', async () => {
                await writeAll({ how_heard: prev })
              })
            }}
            className="text-[11px] border border-[#DEE7FF] rounded-full px-2 py-1 bg-white text-[#062E63] focus:outline-none focus:border-[#325099]"
          >
            <option value="">— not recorded —</option>
            {HOW_HEARD_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {/* Referrer — pick the CUBE family (or mark as outside CUBE). On
            convert, a family referrer triggers the $50 credit to BOTH
            families' invoices via lib/referralCredits. */}
        <div className="col-span-full flex items-center gap-2 flex-wrap">
          <span className="font-semibold">Referred by:</span>
          <button
            type="button"
            onClick={e => setRefPicker({ rect: e.currentTarget.getBoundingClientRect() })}
            className="min-w-[220px] text-left border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs bg-white hover:border-[#325099] focus:outline-none focus:border-[#325099] flex items-center justify-between gap-2"
          >
            <span className={sub.referrer_outside || sub.referrer_student_id ? 'text-[#2A2035] font-semibold' : 'text-[#2A2035]/40'}>
              {sub.referrer_outside
                ? 'Outside of CUBE'
                : (students.find(s => s.id === sub.referrer_student_id)?.full_name || 'Select student…')}
            </span>
            <span className="text-[#2A2035]/30">▾</span>
          </button>
          {refPicker && (
            <SearchSelectPopover
              anchor={refPicker.rect}
              placeholder="Search student or family…"
              clearLabel="— not set —"
              options={(() => {
                const { famGroups, singles } = referrerGroups(students || [])
                return [
                  { value: 'outside', label: 'Outside of CUBE', sub: 'Referrer isn’t a CUBE family — no credit' },
                  ...famGroups.flatMap(g => g.members.map(s => ({ value: s.id, label: s.full_name, sub: g.label }))),
                  ...singles.map(s => ({ value: s.id, label: s.full_name, sub: 'No family linked' })),
                ]
              })()}
              currentValue={sub.referrer_outside ? 'outside' : (sub.referrer_student_id || '')}
              onClose={() => setRefPicker(null)}
              onSelect={async v => {
                setRefPicker(null)
                const patch = v === 'outside'
                  ? { referrer_student_id: null, referrer_outside: true }
                  : { referrer_student_id: v || null, referrer_outside: false }
                // Keep the display/text field in sync when a student is picked.
                if (v && v !== 'outside') {
                  const st = students.find(s => s.id === v)
                  if (st) patch.referred_by = st.full_name
                }
                const prev = { referrer_student_id: sub.referrer_student_id ?? null, referrer_outside: !!sub.referrer_outside, referred_by: sub.referred_by ?? null }
                await writeAll(patch)
                registerUndoAction('referrer', async () => {
                  await writeAll(prev)
                })
              }}
            />
          )}
          {sub.referrer_student_id && (
            <span className="text-[11px] text-emerald-700">
              {status === 'enrolled' ? '$50 referral credits applied to both families' : '$50 credit applies to both families on enrolment'}
            </span>
          )}
          {sub.referrer_outside && <span className="text-[11px] text-[#325099]/50">No referral credit (outside CUBE)</span>}
          {!sub.referrer_student_id && !sub.referrer_outside && sub.referred_by && (
            <span className="text-[11px] text-[#325099]/60">Form says: <strong>{sub.referred_by}</strong> — pick them above to apply the credit</span>
          )}
        </div>
      </div>

      {/* Admin notes */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider">Admin notes</span>
          {!editNotes && (
            <button onClick={() => setEditNotes(true)} className="text-[11px] text-[#325099] hover:underline">Edit</button>
          )}
        </div>
        {editNotes ? (
          <div className="flex gap-2">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="flex-1 text-xs border border-[#DEE7FF] rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:border-[#325099]"
            />
            <div className="flex flex-col gap-1">
              <button onClick={saveNotes} disabled={saving}
                className="text-[11px] font-semibold bg-[#062E63] text-white px-3 py-1 rounded-lg disabled:opacity-40">
                {saving ? '…' : 'Save'}
              </button>
              <button onClick={() => { setEditNotes(false); setNotes(initialNotes) }}
                className="text-[11px] text-[#325099]/50 hover:text-[#325099] px-3 py-1">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#325099]/60 italic">{notes || 'No notes yet'}</p>
        )}
      </div>

    </>
  )
}

// The button that is the card's next step (lib/trialNextStep) — the same amber
// as the 'Next' pill on the card's top line.
const NEXT_BTN = 'ring-2 ring-amber-400 ring-offset-1 bg-amber-50 border-amber-400 text-[#7A4B00] shadow-[0_0_0_4px_rgba(251,191,36,0.18)]'
const NextTag = () => <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">next</span>

// One subject's trial: its class, first lesson, reminder and feedback emails,
// and Convert / Drop. `familyButtons` sits in the same row on a one-subject card.
function SubjectActions({ sub, classes, onUpdate, onReload, onConvertDrop, onOutcomeEmail, familyButtons = null, hl = [] }) {
  const [confirmAction, setConfirmAction] = useState(null) // 'convert' | 'drop' | null
  const stage = STAGE_MAP[sub.status] || STAGE_MAP.new
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Assign class */}
      <select
        value={sub.trial_class_id || ''}
        onChange={async e => {
          const val = e.target.value ? Number(e.target.value) : null
          // The trial starts at the class's earliest upcoming lesson by
          // default; the First trial picker beside this changes it.
          const firstLesson = val ? earliestTrialStart(await lessonDatesFrom(val), isoDate(new Date())) : null

          let studentId = sub.converted_student_id

          // If no student exists yet (old submission), create one now
          if (!studentId && val) {
            const { data: existing } = await supabase
              .from('students').select('id')
              .ilike('full_name', sub.student_name || '')
              .maybeSingle()
            if (existing) {
              studentId = existing.id
            } else {
              const { data: newStudent } = await supabase
                .from('students')
                .insert({ full_name: sub.student_name || 'Unknown', year: sub.student_year || null, school: sub.school || null, status: 'trial' })
                .select('id').single()
              studentId = newStudent?.id
              if (studentId && (sub.parent_name || sub.parent_email || sub.parent_phone)) {
                await supabase.from('guardians').insert({
                  student_id: studentId, full_name: sub.parent_name || null,
                  email: sub.parent_email || null, phone: sub.parent_phone || null,
                })
              }
            }
            // Create the trial enrolment for the first time
            if (studentId) {
              const { data: newEnrol } = await supabase.from('enrolments').insert({
                student_id: studentId, class_id: val, status: 'trial',
                trial_start_date: firstLesson,
              }).select('id').single()
              // Assigning a class IS scheduling the trial: a card still at
              // New or Contacted moves on with it.
              const sched = ['new', 'contacted', 'on_hold'].includes(sub.status) ? { status: 'trial_scheduled', held_at: null, hold_until: null, hold_notified_at: null } : {}
              await supabase.from('trial_submissions').update({ trial_class_id: val, converted_student_id: studentId, enrolment_id: newEnrol?.id, ...sched }).eq('id', sub.id)
              onUpdate(sub.id, { trial_class_id: val, converted_student_id: studentId, enrolment_id: newEnrol?.id, _trialStart: firstLesson, ...sched })
              onReload()
            }
            return
          }

          // Student already exists — update the specific linked enrolment by enrolment_id
          const prevTrialClassId = sub.trial_class_id ?? null
          let prevEnrol = null
          if (sub.enrolment_id) {
            const { data } = await supabase.from('enrolments').select('class_id, trial_start_date, price').eq('id', sub.enrolment_id).maybeSingle()
            prevEnrol = data
            // price: null → the database fills the new class's course
            // price (enrolment_default_price), like a class change in the
            // database explorer.
            await supabase.from('enrolments')
              .update({ class_id: val, price: null, trial_start_date: firstLesson })
              .eq('id', sub.enrolment_id)
          } else if (studentId) {
            // Fallback: update by student_id if no enrolment_id yet
            await supabase.from('enrolments')
              .update({ class_id: val, price: null, trial_start_date: firstLesson })
              .eq('student_id', studentId)
              .eq('status', 'trial')
              .is('class_id', null)
          }
          const sched = val && ['new', 'contacted', 'on_hold'].includes(sub.status) ? { status: 'trial_scheduled', held_at: null, hold_until: null, hold_notified_at: null } : {}
          await supabase.from('trial_submissions').update({ trial_class_id: val, ...sched }).eq('id', sub.id)
          // Assigning a class makes a pending student a trial student
          // (active stays active — e.g. trialling a second subject).
          if (val && studentId) {
            await supabase.from('students').update({ status: 'trial' })
              .eq('id', studentId).eq('status', 'pending')
          }
          onUpdate(sub.id, { trial_class_id: val, _trialStart: firstLesson, ...sched })
          onReload()
          registerUndoAction('trial class assignment', async () => {
            if (sub.enrolment_id && prevEnrol) {
              await supabase.from('enrolments')
                .update({ class_id: prevEnrol.class_id, trial_start_date: prevEnrol.trial_start_date, price: prevEnrol.price ?? null })
                .eq('id', sub.enrolment_id)
            }
            await supabase.from('trial_submissions').update({ trial_class_id: prevTrialClassId }).eq('id', sub.id)
            onUpdate(sub.id, { trial_class_id: prevTrialClassId, _trialStart: prevEnrol?.trial_start_date ?? null })
            onReload()
          })
        }}
        className={`text-xs border border-[#DEE7FF] rounded-full px-3 py-1.5 bg-white text-[#062E63] focus:outline-none focus:border-[#325099] ${hl.includes('assign') ? NEXT_BTN : ''}`}
      >
        <option value="">Assign a class…</option>
        {classes.map(c => (
          <option key={c.id} value={c.id}>{c.class_name} ({c.day_of_week})</option>
        ))}
      </select>

      {/* First trial lesson — defaults to the class's earliest lesson */}
      {sub.trial_class_id && sub.converted_student_id && (
        <TrialStartPicker
          classId={sub.trial_class_id}
          value={sub._trialStart || null}
          onChange={async (date) => {
            const prev = sub._trialStart || null
            const write = (d) => sub.enrolment_id
              ? supabase.from('enrolments').update({ trial_start_date: d }).eq('id', sub.enrolment_id)
              : supabase.from('enrolments').update({ trial_start_date: d })
                  .eq('student_id', sub.converted_student_id).eq('class_id', sub.trial_class_id).eq('status', 'trial')
            const { error } = await write(date)
            if (error) { alert('Could not change the first trial lesson: ' + error.message); return }
            onUpdate(sub.id, { _trialStart: date })
            onReload()
            registerUndoAction('first trial lesson', async () => {
              await write(prev)
              onUpdate(sub.id, { _trialStart: prev })
              onReload()
            })
          }}
        />
      )}

      {familyButtons}

      {/* Trial feedback emails, one after each trial lesson: lesson 1's
          feedback with the next lesson's date, then lesson 2's with how to
          continue. No completion gate: staff read the feedback and decide. */}
      {sub.converted_student_id && sub.status !== 'declined' && (
        <>
          <button
            onClick={() => onOutcomeEmail('lesson1')}
            className={`text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:border-[#325099] transition ${hl.includes('lesson1') ? NEXT_BTN : ''}`}
            title={sub.lesson1_feedback_sent_at
              ? `Lesson 1 feedback emailed ${fmtDate(sub.lesson1_feedback_sent_at)} — compose and send again`
              : 'Email the family the first trial lesson’s feedback, with the next lesson’s date'}
          >
            {sub.lesson1_feedback_sent_at ? '✉ Resend lesson 1 feedback' : '✉ Lesson 1 feedback'}
            {hl.includes('lesson1') && <NextTag />}
          </button>
          <button
            onClick={() => onOutcomeEmail('outcome')}
            className={`text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:border-[#325099] transition ${hl.includes('outcome') ? NEXT_BTN : ''}`}
            title={sub.outcome_sent_at
              ? `Trial outcome emailed ${fmtDate(sub.outcome_sent_at)} — compose and send again`
              : 'Email the second trial lesson’s feedback and how to continue'}
          >
            {sub.outcome_sent_at ? '✉ Resend outcome' : '✉ Trial outcome'}
            {hl.includes('outcome') && <NextTag />}
          </button>
        </>
      )}

      {/* Convert / Drop with double confirmation */}
      {sub.status !== 'enrolled' && sub.status !== 'declined' && (
        confirmAction ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#325099]/70">
              {confirmAction === 'convert' ? 'Convert to active student?' : 'Drop this trial?'}
            </span>
            <button
              onClick={() => { onConvertDrop(sub, confirmAction); setConfirmAction(null) }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition text-white ${confirmAction === 'convert' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'}`}
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="text-xs text-[#325099]/50 hover:text-[#325099] px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setConfirmAction('convert')}
              className={`text-xs font-semibold bg-emerald-600 text-white px-4 py-1.5 rounded-full hover:bg-emerald-700 transition ${hl.includes('decide') ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
            >
              Convert
            </button>
            <button
              onClick={() => setConfirmAction('drop')}
              className={`text-xs font-semibold text-gray-500 border border-gray-200 px-4 py-1.5 rounded-full hover:border-gray-400 transition ${hl.includes('decide') ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
            >
              Drop
            </button>
            {hl.includes('decide') && <NextTag />}
          </>
        )
      )}

      {/* Status badge if already resolved */}
      {(sub.status === 'enrolled' || sub.status === 'declined') && (
        <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${stage.color}`}>
          {stage.label}
        </span>
      )}
    </div>
  )
}

// The invitation and the level test invitation: first contact with the family.
function FamilyButtons({ sub, status, onInvitationEmail, onLevelTestInvitation, hl = [] }) {
  return (
    <>
      {/* Trial invitation — the FIRST email: welcome + a proposed trial
          class matched to year/subject/availability. Hidden once the
          trial is decided either way. */}
      {!['enrolled', 'declined'].includes(status) && (
        <button
          onClick={onInvitationEmail}
          className={`text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:border-[#325099] transition ${hl.includes('invitation') ? NEXT_BTN : ''}`}
          title={sub.invitation_sent_at
            ? `Already emailed ${fmtDate(sub.invitation_sent_at)} — compose and send again`
            : 'Compose the trial invitation — welcome, suggested class and trial date'}
        >
          {sub.invitation_sent_at ? '✉ Resend invitation' : '✉ Trial invitation'}
          {hl.includes('invitation') && <NextTag />}
        </button>
      )}

      {/* Level test invitation — the alternative first email: suggested
          times and a form link; the family's pick books the level test. */}
      {!['enrolled', 'declined'].includes(status) && (
        <button
          onClick={onLevelTestInvitation}
          className={`text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:border-[#325099] transition ${hl.includes('level_test') ? NEXT_BTN : ''}`}
          title={sub.level_test_invitation_sent_at
            ? `Already emailed ${fmtDate(sub.level_test_invitation_sent_at)} — change the times and send again`
            : 'Invite them to sit a level test first — suggested times, booked from a form'}
        >
          {sub.level_test_invitation_sent_at ? '✉ Resend level test invitation' : '✉ Level test invitation'}
          {hl.includes('level_test') && <NextTag />}
        </button>
      )}

    </>
  )
}

// The buttons inside the card that a step points at.
const hlFor = (step) => (!step?.key ? [] : step.key === 'first' ? ['invitation', 'level_test'] : [ACTION_BUTTON[step.key]].filter(Boolean))
// Stage colours for the card's one pill (lib/trialNextStep trialStage).
const STAGE_TONE = {
  new:        'bg-amber-50 text-amber-800 border-amber-200',
  lt_invited: 'bg-sky-50 text-sky-800 border-sky-200',
  lt_booked:  'bg-teal-50 text-teal-800 border-teal-200',
  lt_done:    'bg-teal-100 text-teal-900 border-teal-300',
  invited:    'bg-blue-50 text-blue-800 border-blue-200',
  trial_1:    'bg-violet-50 text-violet-800 border-violet-200',
  trial_2:    'bg-indigo-50 text-indigo-800 border-indigo-200',
  deciding:   'bg-emerald-50 text-emerald-800 border-emerald-200',
  on_hold:    'bg-slate-100 text-slate-600 border-slate-300',
  enrolled:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  declined:   'bg-gray-100 text-gray-500 border-gray-200',
}
const ACT = 'px-2.5 py-0.5 font-bold text-[#5C3900] bg-amber-300 hover:bg-amber-400 border-l border-amber-400 transition whitespace-nowrap'
// The card's one pill: where the student is and, joined to it in amber, the
// action needed (click it to do it). Nothing needed → a grey note instead.
// `items` holds one stage per subject; `onAct(key, sub)` runs an action.
function StagePills({ items, onAct }) {
  if (!items.length) return null
  return (
    <>
      {items.map(({ stage, prefix, sub }, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className={`inline-flex items-stretch rounded-full border overflow-hidden text-[11px] font-semibold ${STAGE_TONE[stage.id] || STAGE_TONE.new}`}>
            <span className="px-2.5 py-0.5 whitespace-nowrap">{prefix}{stage.label}</span>
            {stage.action?.key === 'first' ? (
              <>
                <button onClick={() => onAct('level_test', sub)} className={ACT}>✉ Level test invitation</button>
                <span className="px-1.5 py-0.5 bg-amber-200 text-[#7A4B00] text-[10px] font-semibold border-l border-amber-300 flex items-center">or</span>
                <button onClick={() => onAct('invitation', sub)} className={ACT}>✉ Trial invitation</button>
              </>
            ) : stage.action?.key === 'lt_results' ? (
              <Link href="/tutor/admin/monitoring/level-tests" className={ACT} title="Mark the level test and send the results (with the trial invitation) from Monitoring → Level tests">Level test results →</Link>
            ) : stage.action ? (
              <button onClick={() => onAct(stage.action.key, sub)} className={ACT}>{stage.action.label}</button>
            ) : null}
          </span>
          {stage.note && <span className="text-[11px] italic text-[#2A2035]/45">{stage.note}</span>}
        </span>
      ))}
    </>
  )
}

// What used to sit on the closed card — the stage dropdown, On hold and the
// sent-email dates — now opens with the card.
function StatusRow({ status, onStage, children }) {
  return (
    <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-[#DEE7FF]">
      <span className="text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider">Stage</span>
      <StageSelect status={status} onChange={onStage} />
      {children}
    </div>
  )
}

function CardHeader({ sub, stale, age, subjects, expanded, onToggle, next = null }) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#062E63]">{sub.student_name || 'Unknown student'}</span>
          <span className="text-[11px] bg-[#F0F4FF] text-[#325099] px-2 py-0.5 rounded-full font-medium">
            Year {sub.student_year ? String(sub.student_year).replace(/^year\s*/i, '') : '?'}
          </span>
          {subjects}
          {next}
        </div>
        <p className="text-[11px] text-[#325099]/50 mt-0.5">
          {sub.parent_name && <span className="mr-2">{sub.parent_name}</span>}
          {sub.parent_email && <a href={'mailto:' + sub.parent_email} className="mr-2 hover:underline text-blue-600">{sub.parent_email}</a>}
          {sub.parent_phone && <a href={'tel:' + sub.parent_phone} className="hover:underline">{sub.parent_phone}</a>}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {stale && <span className="text-[10px] font-semibold text-amber-600" title="No action for over a week">{age}d</span>}
        <button onClick={onToggle} className="text-[#325099]/40 hover:text-[#325099] text-sm">
          {expanded ? '▲' : '▼'}
        </button>
      </div>
    </div>
  )
}

function TrialCard({ sub, classes, students, onUpdate, onReload, onConvertDrop, progress, onOutcomeEmail, onInvitationEmail, onLevelTestInvitation, nextTermStart }) {
  const [expanded, setExpanded] = useState(false)
  const [holding, setHolding] = useState(false)
  const age   = daysSince(sub.submitted_at)
  const stale = ['new', 'contacted'].includes(sub.status) && age > 7
  const subjects = Array.isArray(sub.subjects) ? sub.subjects.join(', ') : (sub.subjects || '—')
  const today = isoDate(new Date())
  const step = nextStep(sub, today)
  const stage = trialStage(sub, today)
  const hl = hlFor(step)
  const act = (key) => {
    if (key === 'first' || key === 'invitation') onInvitationEmail()
    else if (key === 'level_test') onLevelTestInvitation()
    else if (key === 'lesson1') onOutcomeEmail('lesson1')
    else if (key === 'outcome') onOutcomeEmail('outcome')
    else setExpanded(true)   // assign a class, convert or drop: open the card
  }

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition ${stale ? 'border-amber-300 shadow-amber-100 shadow-sm' : 'border-[#DEE7FF]'}`}>
      <CardHeader
        sub={sub} stale={stale} age={age}
        subjects={subjects !== '—' && <span className="text-[11px] text-[#325099]/60">{subjects}</span>}
        expanded={expanded} onToggle={() => setExpanded(e => !e)}
        next={<StagePills items={stage ? [{ stage, prefix: '', sub }] : []} onAct={act} />}
      />

      {expanded && (
        <div className="border-t border-[#DEE7FF] px-4 py-3 space-y-3 bg-[#F8FAFF]">
          <StatusRow status={sub.status} onStage={next => (next === 'on_hold' ? setHolding(true) : setStage([sub], next, onUpdate))}>
            {sub.status === 'on_hold' && <HoldBadge sub={sub} onClick={() => setHolding(true)} />}
            <FamilyBadges sub={sub} />
            <SubjectBadges sub={sub} />
            <ProgressBadge progress={progress} />
          </StatusRow>
          <StudentDetails sub={sub} subs={[sub]} status={sub.status} students={students} onUpdate={onUpdate} />
          <div className="pt-1 border-t border-[#DEE7FF]">
            <SubjectActions
              sub={sub} classes={classes} onUpdate={onUpdate} onReload={onReload} onConvertDrop={onConvertDrop}
              onOutcomeEmail={onOutcomeEmail} hl={hl}
              familyButtons={<FamilyButtons sub={sub} status={sub.status} onInvitationEmail={onInvitationEmail} onLevelTestInvitation={onLevelTestInvitation} hl={hl} />}
            />
          </div>
        </div>
      )}
      {holding && <HoldDialog subs={[sub]} nextTermStart={nextTermStart} onClose={() => setHolding(false)} onUpdate={onUpdate} onReload={onReload} />}
    </div>
  )
}

const subjectLabel = (s) => (Array.isArray(s.subjects) ? s.subjects.join(', ') : s.subjects) || 'Subject'

// The student's overall stage: the furthest-along open subject, or — once
// every subject is decided — Enrolled if any enrolled, else Declined.
function groupStage(subs) {
  const open = subs.filter(s => !['enrolled', 'declined', 'on_hold'].includes(s.status))
  if (!open.length) {
    if (subs.some(s => s.status === 'on_hold')) return 'on_hold'
    return subs.some(s => s.status === 'enrolled') ? 'enrolled' : 'declined'
  }
  const rank = (st) => STAGES.findIndex(x => x.id === st)
  return open.reduce((best, s) => (rank(s.status) > rank(best) ? s.status : best), open[0].status)
}

// A student trialling more than one subject: the stage, the family's emails
// and the student's details once, then a tab per subject for its scheduling.
function TrialGroupCard({ subs, classes, students, onUpdate, onReload, onConvertDrop, progress, onOutcomeEmail, onInvitationEmail, onLevelTestInvitation, nextTermStart }) {
  const [expanded, setExpanded] = useState(false)
  const [holding, setHolding] = useState(false)
  const [tab, setTab] = useState(subs[0].id)
  const status = groupStage(subs)
  // Earliest enquiry: the family's first contact, for the age and the details.
  const first = subs.reduce((a, b) => (new Date(a.submitted_at) <= new Date(b.submitted_at) ? a : b))
  const age   = daysSince(first.submitted_at)
  const stale = ['new', 'contacted'].includes(status) && age > 7
  // Family emails: show the first send across the subjects.
  const earliest = (field) => subs.map(s => s[field]).filter(Boolean).sort()[0] || null
  const family = {
    ...first,
    invitation_sent_at: earliest('invitation_sent_at'),
    level_test_invitation_sent_at: earliest('level_test_invitation_sent_at'),
    _levelTest: subs.find(s => s._levelTest?.booked)?._levelTest || subs.find(s => s._levelTest)?._levelTest || null,
  }
  const active = subs.find(s => s.id === tab) || subs[0]
  const className = (id) => classes.find(c => c.id === id)?.class_name
  // Each subject's next step. The family's first emails (invitation, level
  // test) are one thing to do for the student, so they show once, unprefixed;
  // the trial's own steps are per subject ("Maths: ✉ Lesson 1 feedback").
  const today = isoDate(new Date())
  const FAMILY_KEYS = ['first', 'invitation', 'level_test', 'lt_results']
  // The first emails go to the family, so a level test or invitation sent from
  // one subject's card counts for every subject (Luke's level test was booked
  // from his Maths enquiry; his English one is covered by it too).
  const withFamily = (s) => ({
    ...s,
    invitation_sent_at: s.invitation_sent_at || family.invitation_sent_at,
    level_test_invitation_sent_at: s.level_test_invitation_sent_at || family.level_test_invitation_sent_at,
    _levelTest: s._levelTest?.booked ? s._levelTest : (family._levelTest || s._levelTest),
  })
  const stepOf = Object.fromEntries(subs.map(s => [s.id, nextStep(withFamily(s), today)]))
  // One pill per subject — or one for the student while the subjects are at
  // the same stage (the first emails, a shared level test).
  const stages = subs.map(s => ({ sub: s, stage: trialStage(withFamily(s), today) })).filter(x => x.stage)
  const sameStage = stages.every(x => x.stage.id === stages[0]?.stage.id && x.stage.action?.key === stages[0]?.stage.action?.key)
  const items = sameStage && stages.length && !['trial_1', 'trial_2', 'deciding'].includes(stages[0].stage.id)
    ? [{ ...stages[0], prefix: '' }]
    : stages.map(x => ({ ...x, prefix: `${subjectLabel(x.sub)}: ` }))
  const familyHl = [...new Set(subs.flatMap(s => (FAMILY_KEYS.includes(stepOf[s.id]?.key) ? hlFor(stepOf[s.id]) : [])))]
  const openSub = subs.find(s => !['enrolled', 'declined'].includes(s.status)) || first
  const act = (key, s) => {
    if (key === 'first' || key === 'invitation') onInvitationEmail(openSub)
    else if (key === 'level_test') onLevelTestInvitation(openSub)
    else if (key === 'lesson1') onOutcomeEmail(s, 'lesson1')
    else if (key === 'outcome') onOutcomeEmail(s, 'outcome')
    else { setTab(s.id); setExpanded(true) }   // assign a class, convert or drop
  }

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition ${stale ? 'border-amber-300 shadow-amber-100 shadow-sm' : 'border-[#DEE7FF]'}`}>
      <CardHeader
        sub={family} stale={stale} age={age}
        subjects={subs.map(s => {
          const st = STAGE_MAP[s.status] || STAGE_MAP.new
          return (
            <button key={s.id} onClick={() => { setTab(s.id); setExpanded(true) }}
              className="inline-flex items-center gap-1 text-[11px] text-[#325099] bg-white border border-[#DEE7FF] hover:border-[#325099] px-2 py-0.5 rounded-full transition"
              title={`${subjectLabel(s)} — ${st.label}${s.trial_class_id ? ` · ${className(s.trial_class_id) || 'class assigned'}` : ' · no class yet'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {subjectLabel(s)}
            </button>
          )
        })}
        expanded={expanded} onToggle={() => setExpanded(e => !e)}
        next={<StagePills items={items} onAct={act} />}
      />

      {expanded && (
        <div className="border-t border-[#DEE7FF] px-4 py-3 space-y-3 bg-[#F8FAFF]">
          <StatusRow status={status} onStage={next => (next === 'on_hold' ? setHolding(true) : setStage(subs, next, onUpdate))}>
            {status === 'on_hold' && <HoldBadge sub={subs.find(s => s.status === 'on_hold')} onClick={() => setHolding(true)} />}
            <FamilyBadges sub={family} />
            <ProgressBadge progress={progress} />
          </StatusRow>
          <StudentDetails sub={family} subs={subs} status={status} students={students} onUpdate={onUpdate} grouped />
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[#DEE7FF]">
            <FamilyButtons sub={family} status={status} hl={familyHl}
              onInvitationEmail={() => onInvitationEmail(openSub)}
              onLevelTestInvitation={() => onLevelTestInvitation(openSub)} />
          </div>

          {/* A tab per subject: its own class, trial dates, emails and outcome. */}
          <div className="bg-white border border-[#DEE7FF] rounded-xl overflow-hidden">
            <div className="flex border-b border-[#DEE7FF] bg-[#F8FAFF]">
              {subs.map(s => {
                const st = STAGE_MAP[s.status] || STAGE_MAP.new
                const on = s.id === active.id
                return (
                  <button key={s.id} onClick={() => setTab(s.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition ${on ? 'border-[#062E63] text-[#062E63] bg-white' : 'border-transparent text-[#325099]/60 hover:text-[#325099]'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    {subjectLabel(s)}
                    {['enrolled', 'declined'].includes(s.status) && <span className={`text-[9px] font-semibold border px-1.5 py-px rounded-full ${st.color}`}>{st.label}</span>}
                    {/* this subject has something to do */}
                    {stepOf[s.id]?.key && !FAMILY_KEYS.includes(stepOf[s.id].key) && <span className="w-2 h-2 rounded-full bg-amber-400" title={`Next: ${stepOf[s.id].label}`} />}
                  </button>
                )
              })}
            </div>
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs text-[#325099]/70">
                <span><span className="font-semibold">First trial lesson:</span> {active._trialStart ? fmtDay(active._trialStart) : '—'}</span>
                <SubjectBadges sub={active} />
              </div>
              <SubjectActions
                key={active.id}
                sub={active} classes={classes} onUpdate={onUpdate} onReload={onReload} onConvertDrop={onConvertDrop}
                onOutcomeEmail={(stage) => onOutcomeEmail(active, stage)}
                hl={hlFor(stepOf[active.id]).filter(k => !['invitation', 'level_test'].includes(k))}
              />
            </div>
          </div>
        </div>
      )}
      {holding && <HoldDialog subs={subs} nextTermStart={nextTermStart} onClose={() => setHolding(false)} onUpdate={onUpdate} onReload={onReload} />}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TrialsPage() {
  const router = useRouter()
  const [profile,     setProfile]     = useState(null)
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [submissions, setSubmissions] = useState([])
  const [classes,     setClasses]     = useState([])
  const [students,    setStudents]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [filterStage, setFilterStage] = useState('all')
  const [search,      setSearch]      = useState('')
  const [showArchive, setShowArchive] = useState(false)
  // studentId → { attended, withFeedback } for the trial-lesson badge
  const [trialProgress, setTrialProgress] = useState({})
  // the trial feedback email being composed: { sub, stage: 'lesson1' | 'outcome' }
  const [outcomeSub,    setOutcomeSub]    = useState(null)
  const [invitationSub, setInvitationSub] = useState(null)
  const [levelTestSub,  setLevelTestSub]  = useState(null)
  const [enrolTerm,     setEnrolTerm]     = useState(null)   // trial target term (holiday rows excluded)
  const [nextTermStart, setNextTermStart] = useState(null)   // a hold's "start of next term" check-back

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor')
        return
      }
      setProfile(profile)
      setIsAdmin(true)
    })
  }, [router])

  // quiet: refresh in place (after a class or trial date change) without the
  // loading screen.
  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    // Trials join the term being taught now (or the upcoming one during
    // holidays) — classes are per-term rows, so an unscoped fetch would list
    // every class once per term. Holiday rows exist in terms (pay periods,
    // holiday workshops) but a trial belongs to a REAL term's classes: during
    // the break getEnrolmentTerm would otherwise return the holiday row and
    // starve the class list.
    const realTerms = (await fetchAllTerms()).filter(t => !/holiday/i.test(t.name || ''))
    const term = getEnrolmentTerm(realTerms)
    setEnrolTerm(term)
    const todayIso = isoDate(new Date())
    setNextTermStart(realTerms.map(t => t.start_date).filter(d => d && d > todayIso).sort()[0] || null)
    const classCols = 'id, class_name, day_of_week, start_time, end_time, course_id'
    const classQuery = term?.id ? classesForTerm(term.id, classCols) : classesAllTerms(classCols)
    const [subRes, classRes, studentRes] = await Promise.all([
      supabase
        .from('trial_submissions')
        .select('*')
        .order('submitted_at', { ascending: false }),
      classQuery,
      supabase
        .from('students')
        .select('id, full_name, family_id, status')
        .order('full_name'),
    ])
    const subs = subRes.data || []
    let classList = classRes.data || []

    // The class can be (re)assigned on the ENROLMENT row in the database
    // explorer, which leaves trial_submissions.trial_class_id stale — and the
    // "Assign class" dropdown looking empty. Read each trial's live enrolment
    // class, prefer it, and heal the submission row so the two stay in sync.
    const enrolIds = subs.map(s => s.enrolment_id).filter(Boolean)
    // Fetch trial enrolments for EVERY linked student, not just submissions
    // missing an enrolment_id — if the linked enrolment row was deleted or
    // can't be read, the student's other trial enrolments still answer.
    const studentIds = subs.filter(s => s.converted_student_id).map(s => s.converted_student_id)
    const [byId, byStudent] = await Promise.all([
      enrolIds.length ? supabase.from('enrolments').select('id, class_id').in('id', enrolIds) : Promise.resolve({ data: [] }),
      studentIds.length ? supabase.from('enrolments').select('student_id, class_id, status, trial_start_date').in('student_id', studentIds).in('status', ['trial', 'trial complete']) : Promise.resolve({ data: [] }),
    ])
    const classByEnrol = Object.fromEntries((byId.data || []).map(r => [r.id, r.class_id]))
    // Prefer an enrolment that HAS a class — a classless stub must not mask a
    // real assignment sitting on the student's other trial enrolment.
    const classByStudent = {}
    for (const r of (byStudent.data || [])) {
      if (r.class_id != null || !(r.student_id in classByStudent)) classByStudent[r.student_id] = r.class_id
    }
    // A student trialling two subjects has one submission per subject, each
    // linked to its own enrolment. The fallback below must not hand one
    // subject the class its sibling already holds (Maths and English would
    // both read the Maths class), so it skips classes a sibling claims.
    const claimedByStudent = {}
    for (const s of subs) {
      const c = s.enrolment_id ? classByEnrol[s.enrolment_id] : null
      if (s.converted_student_id && c != null) (claimedByStudent[s.converted_student_id] ||= new Set()).add(c)
    }
    const healed = []
    const merged = subs.map(s => {
      // On hold released its class on purpose; leave it be.
      if (s.status === 'on_hold') return s
      let live = s.enrolment_id ? classByEnrol[s.enrolment_id] : undefined
      // Fall back to the student's trial enrolments when the direct link
      // yields nothing (missing row) or no class.
      if ((live === undefined || live === null) && s.converted_student_id) {
        const claimed = claimedByStudent[s.converted_student_id] || new Set()
        const siblings = subs.filter(x => x.converted_student_id === s.converted_student_id).length
        const spare = (byStudent.data || []).find(r => r.student_id === s.converted_student_id && r.class_id != null && !claimed.has(r.class_id))
        if (siblings > 1) { if (spare) live = spare.class_id }
        else if (classByStudent[s.converted_student_id] != null) live = classByStudent[s.converted_student_id]
      }
      // undefined = no enrolment row found; null = enrolment exists with no class
      if (live !== undefined && live !== s.trial_class_id) {
        healed.push({ id: s.id, val: live })
        return { ...s, trial_class_id: live }
      }
      return s
    })
    for (const h of healed) {
      supabase.from('trial_submissions').update({ trial_class_id: h.val }).eq('id', h.id)
        .then(({ error }) => { if (error) console.warn('trial_class_id heal failed for submission', h.id, error.message) })
    }

    // Student status follows the pipeline: a student with a trial class
    // assigned who hasn't been converted yet is a TRIAL student, not pending.
    // (Convert sets active; Drop sets quit trial; this closes the gap where a
    // class was assigned — here or in the explorer — but the student record
    // still said pending.) Only pending is promoted: an active student
    // trialling a second subject must stay active.
    const statusById = Object.fromEntries((studentRes.data || []).map(s => [s.id, s.status]))
    for (const s of merged) {
      if (['enrolled', 'declined'].includes(s.status)) continue
      if (!s.converted_student_id || s.trial_class_id == null) continue
      if ((statusById[s.converted_student_id] || '').toLowerCase() !== 'pending') continue
      statusById[s.converted_student_id] = 'trial'
      const row = (studentRes.data || []).find(x => x.id === s.converted_student_id)
      if (row) row.status = 'trial'
      supabase.from('students').update({ status: 'trial' })
        .eq('id', s.converted_student_id).eq('status', 'pending').then(() => {})
    }

    // A live class can sit outside the enrolment-term list (assigned in the
    // explorer for another term) — fetch those so the dropdown can show them.
    const known = new Set(classList.map(c => c.id))
    const missing = [...new Set(merged.map(s => s.trial_class_id).filter(id => id != null && !known.has(id)))]
    if (missing.length) {
      const { data: extra } = await supabase.from('classes').select(classCols).in('id', missing)
      classList = [...classList, ...(extra || [])]
    }

    // The pipeline follows what actually happened: an untouched enquiry (still
    // New) whose student has a trial class — an enrolment made here or in the
    // explorer — is scheduled. A stage set by hand (Contacted, say) is left
    // alone; staff move it when they are ready.
    for (const s of merged) {
      if (s.status !== 'new' || s.trial_class_id == null) continue
      s.status = 'trial_scheduled'
      supabase.from('trial_submissions').update({ status: 'trial_scheduled' })
        .eq('id', s.id).eq('status', 'new').then(() => {})
    }

    // The trial reminders send themselves 24 hours before each trial lesson
    // (lib/autoReminders); the card only shows the first trial lesson.
    const trialRows = (byStudent.data || []).filter(r => r.status === 'trial' && r.class_id != null)
    // Each card's first trial lesson: the trial start on its class's enrolment.
    for (const s of merged) {
      const row = trialRows.find(r => r.student_id === s.converted_student_id && r.class_id === s.trial_class_id)
      s._trialStart = row?.trial_start_date || null
    }
    // …and both trial lesson dates, for the card's "waiting for lesson 2 · Sat 31 Oct".
    const trialClassIds = [...new Set(merged.map(s => s.trial_class_id).filter(c => c != null))]
    if (trialClassIds.length) {
      const { data: tl } = await supabase.from('lessons').select('class_id, lesson_date')
        .in('class_id', trialClassIds).eq('is_makeup', false).neq('status', 'cancelled').order('lesson_date')
      const datesByClass = {}
      for (const l of tl || []) (datesByClass[l.class_id] ||= []).push(l.lesson_date)
      for (const s of merged) {
        s._trialDates = s.trial_class_id != null ? trialDatesFor([...new Set(datesByClass[s.trial_class_id] || [])], s._trialStart) : []
      }
    }
    // Trial lesson progress per student. A trial runs per SUBJECT — someone
    // trialling Maths and English sits two sets of lessons — so progress is
    // counted per class and reported as the least-advanced one. Summing rows
    // across classes would read "3 lessons" for a student who has had two
    // Maths lessons and one English.
    //
    // trial_feedback marks a lesson as a trial lesson: SessionMarker only
    // writes it while the enrolment is a trial (and requires it), so counting
    // those rows also stops the tally growing once the student enrols.
    const allStudentIds = [...new Set(merged.map(s => s.converted_student_id).filter(Boolean))]
    if (allStudentIds.length) {
      const { data: att } = await supabase
        .from('attendance')
        .select('student_id, class_id, trial_feedback')
        .in('student_id', allStudentIds)
        .in('status', ['present', 'late'])
      const perClass = {}   // studentId → { classId: lessons }
      for (const a of att || []) {
        if (!(a.trial_feedback || '').trim()) continue
        const byClass = (perClass[a.student_id] ||= {})
        byClass[a.class_id] = (byClass[a.class_id] || 0) + 1
      }
      const classNameById = Object.fromEntries(classList.map(c => [c.id, c.class_name]))
      const prog = {}
      for (const [studentId, byClass] of Object.entries(perClass)) {
        const counts = Object.values(byClass)
        prog[studentId] = {
          // The trial is only done when every subject has had its lessons.
          lessons: Math.min(...counts),
          subjects: counts.length,
          breakdown: Object.entries(byClass)
            .map(([cid, n]) => `${classNameById[cid] || `Class ${cid}`}: ${n}/${TRIAL_LESSONS}`)
            .join(' · '),
        }
      }
      setTrialProgress(prog)
    } else {
      setTrialProgress({})
    }

    // Level test invitations: the family's answer on their form — the booked
    // test, or the times they gave when none suited.
    const { data: invites } = await supabase.from('level_test_invites')
      .select('submission_id, lesson_id, parent_note, responded_at, lessons:lesson_id(lesson_date, start_time, end_time, report_emailed_at)')
    const inviteBySub = Object.fromEntries((invites || []).map(i => [i.submission_id, i]))
    for (const s of merged) {
      const i = inviteBySub[s.id]
      s._levelTest = i ? {
        booked: i.lessons ? { date: i.lessons.lesson_date, start: String(i.lessons.start_time || '').slice(0, 5) } : null,
        note: i.responded_at && !i.lessons ? (i.parent_note || '') : '',
        reportSent: !!i.lessons?.report_emailed_at,
      } : null
    }

    // Trial invitation class pickers: what the family chose on the form (a
    // class books itself; a 1:1 time is for staff to set up) or the times
    // they gave when nothing suited. The newest invite for each request wins.
    const { data: trialInvites } = await supabase.from('trial_invites')
      .select('submission_ids, sections, picks, note, responded_at, created_at').order('created_at')
    const trialInviteBySub = {}
    for (const inv of trialInvites || []) {
      for (const sid of inv.submission_ids || []) {
        const sec = (inv.sections || []).find(x => x.submission_id === sid)
        const pickedId = inv.picks?.[sid]?.option_id
        trialInviteBySub[sid] = {
          pick: pickedId ? (sec?.options || []).find(o => o.id === pickedId) || null : null,
          note: inv.responded_at && !pickedId ? (inv.note || '') : '',
        }
      }
    }
    for (const s of merged) s._trialInvite = trialInviteBySub[s.id] || null

    setSubmissions(merged)
    setClasses(classList)
    setStudents((studentRes.data || []).filter(s => !REFERRER_EXCLUDED_STATUSES.includes((s.status || '').toLowerCase())))
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // The pipeline heals itself from live enrolments at load time — so reload
  // when the tab regains focus, and an assignment made in the database
  // explorer (another tab) appears here without a manual refresh. Throttled:
  // a quick alt-tab shouldn't refire every query.
  useEffect(() => {
    let last = Date.now()
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - last < 10000) return
      last = Date.now()
      loadData()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [loadData])

  const handleUpdate = useCallback((id, patch) => {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }, [])

  // The latest submissions, for the convert/drop handler (which is memoised).
  const subsRef = useRef([])
  useEffect(() => { subsRef.current = submissions }, [submissions])

  // A student trialling several subjects converts or drops ONE subject at a
  // time: only that subject's trial enrolment moves. A one-subject trial moves
  // every trial enrolment, as it always has (it may have classless stubs).
  const trialEnrolments = (sub) => {
    let q = supabase.from('enrolments')
    const siblings = subsRef.current.filter(x => x.converted_student_id && x.converted_student_id === sub.converted_student_id && x.id !== sub.id)
    const scoped = siblings.length > 0
    return {
      update: (patch) => {
        q = q.update(patch)
        if (scoped && sub.enrolment_id) return q.eq('id', sub.enrolment_id).in('status', ['trial', 'trial complete'])
        if (scoped) return q.eq('student_id', sub.converted_student_id).eq('class_id', sub.trial_class_id ?? -1).in('status', ['trial', 'trial complete'])
        return q.eq('student_id', sub.converted_student_id).in('status', ['trial', 'trial complete'])
      },
    }
  }

  const handleConvertDrop = useCallback(async (sub, action) => {
    const id = sub.id
    const studentId = sub.converted_student_id
    if (action === 'convert') {
      if (studentId) {
        await trialEnrolments(sub).update({ status: 'active' })
        await supabase.from('students').update({ status: 'active' }).eq('id', studentId)
      }
      await supabase.from('trial_submissions').update({ status: 'enrolled', converted_at: new Date().toISOString() }).eq('id', id)
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'enrolled' } : s))

      // Referral credit: if a CUBE family referred this student, apply $50 to
      // BOTH families' invoices (shared rules in lib/referralCredits; skips
      // automatically if a referral was already logged for this student).
      const { data: fresh } = await supabase.from('trial_submissions')
        .select('referrer_student_id, referrer_outside, student_name').eq('id', id).maybeSingle()
      if (fresh?.referrer_student_id && !fresh.referrer_outside) {
        if (!studentId) {
          alert('Referral credit NOT applied: this trial has no linked student record yet. Log the referral from the Invoices page once the student exists.')
        } else {
          try {
            // The referring student's first name goes on the new family's
            // discount line ("Referral Discount: referred by Monica").
            const { data: referrer } = await supabase.from('students')
              .select('full_name').eq('id', fresh.referrer_student_id).maybeSingle()
            const res = await logReferralWithCredits({
              referringStudentId: fresh.referrer_student_id,
              referredStudentId: studentId,
              referredFirstName:  (fresh.student_name || '').split(' ')[0],
              referringFirstName: (referrer?.full_name || '').split(' ')[0],
            })
            if (res.skipped) {
              // Already credited earlier — nothing to do.
            } else {
              alert(`Referral credits applied: $50 to the new family (${res.referredApplied ? 'on their current invoice' : 'held for their next invoice'}) and $50 to the referring family (${res.referringApplied ? 'on their draft invoice' : 'held for their next invoice'}).`)
            }
          } catch (e) {
            alert('Enrolment converted, but the referral credit failed: ' + e.message + '\nYou can log it manually from the Invoices page.')
          }
        }
      }
    } else {
      if (studentId) {
        // ONLY the trial enrolments — same guard the convert branch above uses.
        // Without it this disenrolled every enrolment the student had: a trial
        // declined for an existing student wiped their real, paid classes, and
        // the term rollover (which only carries active/trial rows) then dropped
        // them from the new term entirely.
        const today = new Date().toISOString().split('T')[0]
        await trialEnrolments(sub).update({ status: 'disenrol', ended_at: today, end_reason: 'Trial declined' })

        // Only mark the student as having quit if this was their only tie to
        // CUBE. Someone already attending other classes has not quit because
        // one trial for a different subject was declined — nor has someone
        // still trialling their other subject.
        const { data: remaining } = await supabase.from('enrolments')
          .select('id').eq('student_id', studentId).in('status', ['active', 'trial', 'trial complete']).limit(1)
        if (!remaining?.length) {
          await supabase.from('students').update({ status: 'quit trial' }).eq('id', studentId)
        }
      }
      await supabase.from('trial_submissions').update({ status: 'declined' }).eq('id', id)
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'declined' } : s))
    }
  }, [])

  // One card per student: a student trialling Maths and English has a
  // submission per subject, grouped by their student record (or, before one
  // exists, by name + parent email). Newest enquiry first, as before.
  const groups = useMemo(() => {
    const byKey = new Map()
    for (const s of submissions) {
      const key = s.converted_student_id
        || `${(s.student_name || '').trim().toLowerCase()}|${(s.parent_email || '').trim().toLowerCase()}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(s)
    }
    return [...byKey.entries()].map(([key, subs]) => ({
      key,
      // subject tabs in a stable order: first enquiry first
      subs: [...subs].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)),
      status: groupStage(subs),
      submitted_at: subs.map(x => x.submitted_at).filter(Boolean).sort()[0] || null,
    }))
  }, [submissions])

  // Filter students
  const ARCHIVE = ['enrolled', 'declined']
  const visible = groups.filter(g => {
    if (!showArchive && ARCHIVE.includes(g.status)) return false
    // On hold sits out of the main list — its own pill shows them.
    if (filterStage === 'all' && g.status === 'on_hold') return false
    if (filterStage !== 'all' && g.status !== filterStage) return false
    if (search) {
      const q = search.toLowerCase()
      return g.subs.some(s =>
        s.student_name?.toLowerCase().includes(q) ||
        s.parent_name?.toLowerCase().includes(q)  ||
        s.parent_email?.toLowerCase().includes(q) ||
        s.school?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const stagesWithCount = STAGES.map(st => ({
    ...st,
    count: groups.filter(g => g.status === st.id && !(ARCHIVE.includes(st.id) && !showArchive)).length,
  }))

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-6xl mx-auto px-6 pt-10 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/tutor/database" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Database</Link>
            </div>
            <h1 className="text-2xl font-bold text-[#062E63]">Trials</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Manage free trial submissions and active trial enrolments.</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/trial-submission"
              target="_blank"
              className="text-xs font-semibold text-[#325099]/60 border border-[#DEE7FF] px-3 py-1.5 rounded-full hover:border-[#325099] transition"
              title="Webhook URL for your website form"
            >
              API endpoint
            </a>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Counted per student: a two-subject trial is one student. */}
            <StatsBar submissions={groups} />

            {/* The flow the team works to, step by step */}
            <PipelineFlow />

            {/* Acquisition channels report */}
            <ChannelInsights submissions={submissions} />

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, email, school…"
                className="border border-[#DEE7FF] rounded-full px-3 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099] w-52"
              />
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => setFilterStage('all')}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${filterStage === 'all' ? 'bg-[#062E63] text-white border-[#062E63]' : 'border-[#DEE7FF] text-[#325099]/60 hover:border-[#325099]'}`}>
                  All
                </button>
                {stagesWithCount.filter(s => !ARCHIVE.includes(s.id) || showArchive).map(st => (
                  <button key={st.id} onClick={() => setFilterStage(st.id)}
                    className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${filterStage === st.id ? 'bg-[#062E63] text-white border-[#062E63]' : 'border-[#DEE7FF] text-[#325099]/60 hover:border-[#325099]'}`}>
                    {st.label} {st.count > 0 && <span className="opacity-60">({st.count})</span>}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowArchive(a => !a)}
                className="ml-auto text-[11px] text-[#325099]/50 hover:text-[#325099] transition">
                {showArchive ? 'Hide archived' : 'Show enrolled/declined'}
              </button>
            </div>

            {/* Cards */}
            {visible.length === 0 ? (
              <div className="text-center py-16 text-[#325099]/40">
                <p className="text-lg mb-1">No submissions found</p>
                <p className="text-sm">New trial form submissions will appear here automatically.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map(g => g.subs.length > 1 ? (
                  <TrialGroupCard
                    key={g.key}
                    subs={g.subs}
                    classes={classes}
                    students={students}
                    onUpdate={handleUpdate}
                    onReload={() => loadData({ quiet: true })}
                    onConvertDrop={handleConvertDrop}
                    progress={trialProgress[g.subs[0].converted_student_id]}
                    // feedback for this subject's class only
                    onOutcomeEmail={(sub, stage) => setOutcomeSub({ sub, stage, classId: sub.trial_class_id })}
                    onInvitationEmail={(sub) => setInvitationSub(sub)}
                    onLevelTestInvitation={(sub) => setLevelTestSub(sub)}
                    nextTermStart={nextTermStart}
                  />
                ) : (
                  <TrialCard
                    key={g.key}
                    sub={g.subs[0]}
                    classes={classes}
                    students={students}
                    onUpdate={handleUpdate}
                    onReload={() => loadData({ quiet: true })}
                    onConvertDrop={handleConvertDrop}
                    progress={trialProgress[g.subs[0].converted_student_id]}
                    onOutcomeEmail={(stage) => setOutcomeSub({ sub: g.subs[0], stage })}
                    onInvitationEmail={() => setInvitationSub(g.subs[0])}
                    onLevelTestInvitation={() => setLevelTestSub(g.subs[0])}
                    nextTermStart={nextTermStart}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {outcomeSub && (
        <TrialOutcomeModal
          sub={outcomeSub.sub}
          stage={outcomeSub.stage}
          classId={outcomeSub.classId ?? null}
          onClose={() => setOutcomeSub(null)}
          onSent={(field, sentAt) => {
            // Keep the first-send date the server recorded.
            if (field) handleUpdate(outcomeSub.sub.id, { [field]: outcomeSub.sub[field] || sentAt || new Date().toISOString() })
            setOutcomeSub(null)
          }}
        />
      )}

      {levelTestSub && (
        <LevelTestInvitationModal
          sub={levelTestSub}
          onClose={() => { setLevelTestSub(null); loadData({ quiet: true }) }}
          onSent={(sentAt, stamped) => {
            const now = sentAt || new Date().toISOString()
            handleUpdate(levelTestSub.id, {
              // first-send date only — a resend keeps the original
              level_test_invitation_sent_at: levelTestSub.level_test_invitation_sent_at || now,
              ...(stamped ? { status: 'contacted', contacted_at: now } : {}),
            })
          }}
        />
      )}

      {invitationSub && (
        <TrialInvitationModal
          sub={invitationSub}
          // The family's other open requests (same parent email) — e.g. Maths and
          // English for one child — can go in the same email.
          related={submissions.filter(x => x.id !== invitationSub.id
            && (x.parent_email || '').trim().toLowerCase() === (invitationSub.parent_email || '').trim().toLowerCase()
            && (invitationSub.parent_email || '').trim()
            && !['enrolled', 'declined'].includes(x.status))}
          classes={classes}
          term={enrolTerm}
          onClose={() => setInvitationSub(null)}
          onSent={(sentIds, stampedIds) => {
            // Mirror the route's stamping locally so every card moves at once.
            const now = new Date().toISOString()
            for (const id of sentIds) {
              const s0 = submissions.find(x => x.id === id)
              handleUpdate(id, {
                // the invited date is first-send only — a resend keeps the original
                invitation_sent_at: s0?.invitation_sent_at || now,
                ...(stampedIds.includes(id) ? { status: 'contacted', contacted_at: now } : {}),
              })
            }
          }}
        />
      )}
    </div>
  )
}
