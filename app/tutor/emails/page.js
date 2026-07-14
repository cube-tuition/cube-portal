'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'

// Editable send-cadence guide — shared definitions in lib/emailCadence.js
// (the Action Centre reads the same rows to raise 📧 actionables each week).
import { CADENCE_KEY, DEFAULT_CADENCE } from '../../../lib/emailCadence'

const CAMPAIGNS = [
  {
    href:        '/tutor/emails/term-start',
    icon:        '🎉',
    title:       'Term Start',
    description: 'Send re-enrolment confirmation emails to families at the start of a new term. Includes class details, term dates, and invoice notice.',
    badge:       null,
  },
  {
    href:        '/tutor/emails/trials',
    icon:        '🧪',
    title:       'Trials',
    description: 'Trial reminders for new students — a welcome email with their first lesson date and time, no invoice. Sent any time during the term as trials are booked.',
    badge:       null,
  },
  {
    href:        '/tutor/emails/end-of-term',
    icon:        '📋',
    title:       'End-of-Term Reports',
    description: 'Upload individual student reports and send a thank-you email with PDFs attached to each family. Siblings are grouped into one email.',
    badge:       null,
  },
  {
    href:        '/tutor/emails/discount-program',
    icon:        '🎁',
    title:       'Discount Program',
    description: 'Marketing email introducing the referral program ($50 for both families), multi-course and sibling discounts. Preview, test-send, then send to all active families.',
    badge:       'Marketing',
  },
  {
    href:        '/tutor/emails/course-offers',
    icon:        '📣',
    title:       'Course Offers',
    description: 'Promote a course to a targeted cohort — e.g. Maths to English-only students, or Chemistry to Year 10. Save reusable offers with an audience filter and editable pitch, then preview, test, and send.',
    badge:       'Marketing',
  },
]

export default function EmailsHub() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [cadence, setCadence] = useState(DEFAULT_CADENCE)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [savingCadence, setSavingCadence] = useState(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor')
      } else {
        setProfile(profile)
        supabase.from('portal_settings').select('value').eq('key', CADENCE_KEY).maybeSingle()
          .then(({ data }) => { if (data?.value) setCadence(data.value) })
      }
    })
  }, [router])

  const saveCadence = async () => {
    setSavingCadence(true)
    const value = draft.trim() || DEFAULT_CADENCE
    const { error } = await supabase.from('portal_settings')
      .upsert({ key: CADENCE_KEY, value, updated_at: new Date().toISOString() })
    setSavingCadence(false)
    if (error) { alert('Could not save: ' + error.message); return }
    setCadence(value)
    setEditing(false)
  }

  const cadenceRows = cadence.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => l.split('|').map(p => p.trim()))

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-4xl mx-auto px-6 pt-10 pb-24">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#062E63]">Emails</h1>
          <p className="text-sm text-[#325099]/60 mt-1">Send bulk emails to families using portal data.</p>
        </div>

        {/* ── Send cadence (editable, persisted in portal_settings) ──────── */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[#062E63]">📅 Send cadence — per 10-week term</h2>
            {!editing ? (
              <button onClick={() => { setDraft(cadence); setEditing(true) }} className="text-xs font-semibold text-[#325099] hover:underline">✏️ Edit</button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setDraft(DEFAULT_CADENCE)} className="text-[10px] font-semibold text-[#2A2035]/40 hover:text-[#325099]">Reset to default</button>
                <button onClick={() => setEditing(false)} className="text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035]">Cancel</button>
                <button onClick={saveCadence} disabled={savingCadence} className="text-xs font-semibold bg-[#325099] text-white px-3 py-1.5 rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
                  {savingCadence ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={Math.max(6, draft.split('\n').length + 1)}
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2.5 text-xs font-mono text-[#2A2035] leading-relaxed focus:outline-none focus:border-[#325099] resize-y"
              />
              <p className="text-[10px] text-[#2A2035]/40 mt-1.5">One row per line: <code className="font-mono">When | Email | Notes</code></p>
            </>
          ) : (
            <div className="divide-y divide-[#F0F4FF]">
              {cadenceRows.map((row, i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <span className="text-[11px] font-bold text-[#325099] w-32 shrink-0 pt-0.5">{row[0] || ''}</span>
                  <span className="text-xs font-semibold text-[#062E63] w-40 shrink-0 pt-0.5">{row[1] || ''}</span>
                  <span className="text-xs text-[#2A2035]/60 leading-relaxed flex-1">{row[2] || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {CAMPAIGNS.map(c => (
            <Link
              key={c.href}
              href={c.href}
              className="group bg-white border border-[#DEE7FF] rounded-2xl p-6 hover:border-[#325099]/40 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{c.icon}</span>
                {c.badge && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-[#DEE7FF] text-[#325099] px-2 py-0.5 rounded-full">
                    {c.badge}
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-[#062E63] mb-1 group-hover:text-[#325099] transition">
                {c.title}
              </h2>
              <p className="text-sm text-[#325099]/60 leading-relaxed">{c.description}</p>
              <div className="mt-4 text-xs font-semibold text-[#325099] group-hover:text-[#062E63] transition">
                Open →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
