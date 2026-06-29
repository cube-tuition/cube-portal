'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm } from '../../../../lib/terms'
import { T_STUDENTS, T_PARENTS, T_CLASSES, T_ENROLMENTS, T_COURSE_OFFERS } from '../../../../lib/tables'
import { inferSubject } from '../../../../components/CourseDetail'
import { TEST_RECIPIENT } from '../../../../lib/emailConfig'
import {
  OFFER_SUBJECTS, OFFER_YEARS, DEFAULT_OFFER_BODY, buildCourseOfferEmailHtml,
} from '../../../../lib/courseOfferEmail'

/*
 * Course Offers — /tutor/emails/course-offers
 *
 * A library of promotional campaigns pitching a course to a targeted cohort
 * (e.g. Maths to English-only students, Chemistry to Year 10). Each offer saves
 * an audience filter (year levels + must-do / must-not-do subjects) and editable
 * email content. Recipients are computed live from current enrolments, then you
 * fine-tune, preview, test, and send. The discount is messaging only.
 */

const BLANK = () => ({
  name: 'Untitled offer', email_subject: '', body: DEFAULT_OFFER_BODY,
  year_levels: [], requires_subjects: [], excludes_subjects: [],
})

const familyKeyFor = (s) =>
  s.family_id != null ? `f_${s.family_id}` : (s.parent_email ? `e_${s.parent_email.toLowerCase()}` : `s_${s.id}`)

export default function CourseOffersPage() {
  const router = useRouter()
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [students, setStudents] = useState([])   // {id, full_name, year, family_id, subjects[], parent_name, parent_email}

  const [offers, setOffers]     = useState([])   // saved campaigns
  const [currentId, setCurrentId] = useState('') // selected offer id
  const [draft, setDraft]       = useState(BLANK())
  const [dirty, setDirty]       = useState(false)
  const [saving, setSaving]     = useState(false)

  const [unchecked, setUnchecked] = useState(() => new Set()) // family keys the user opted out
  const [sending, setSending]   = useState(false)
  const [testing, setTesting]   = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [results, setResults]   = useState(null)
  const [testSentTo, setTestSentTo] = useState(null)
  const [error, setError]       = useState(null)

  const loadOfferIntoDraft = (o) => {
    setCurrentId(o.id)
    setDraft({
      name: o.name || 'Untitled offer', email_subject: o.email_subject || '', body: o.body || DEFAULT_OFFER_BODY,
      year_levels: o.year_levels || [], requires_subjects: o.requires_subjects || [], excludes_subjects: o.excludes_subjects || [],
    })
    setDirty(false); setUnchecked(new Set()); setResults(null); setTestSentTo(null)
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)

      const allTerms = await fetchAllTerms()
      const term = getCurrentTerm(allTerms)
      const [{ data: studentRows }, { data: guardians }, { data: classRows }, { data: enrolRows }, { data: offerRows }] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, family_id, year, status').eq('status', 'active').order('full_name'),
        supabase.from(T_PARENTS).select('student_id, full_name, email'),
        term ? supabase.from(T_CLASSES).select('id, class_name').eq('term_id', term.id) : Promise.resolve({ data: [] }),
        term ? supabase.from(T_ENROLMENTS).select('student_id, class_id, status, ended_at') : Promise.resolve({ data: [] }),
        supabase.from(T_COURSE_OFFERS).select('*').order('updated_at', { ascending: false }),
      ])

      // class_id → class_name (current term), then student_id → set of subjects.
      const classById = {}
      for (const c of classRows || []) classById[c.id] = c.class_name
      const subjByStudent = {}
      for (const e of enrolRows || []) {
        const name = classById[e.class_id]
        if (!name || e.ended_at || !['active', 'trial'].includes(e.status)) continue
        const subj = inferSubject({ class_name: name })
        if (!subj) continue
        ;(subjByStudent[e.student_id] ||= new Set()).add(subj)
      }
      const gByStudent = {}
      for (const g of guardians || []) (gByStudent[String(g.student_id)] ||= []).push(g)

      setStudents((studentRows || []).map(s => {
        const gs = gByStudent[s.id] || []
        const primary = gs.find(g => g.email) || gs[0] || null
        return {
          id: s.id, full_name: s.full_name, year: s.year, family_id: s.family_id,
          subjects: [...(subjByStudent[s.id] || [])],
          parent_name: primary?.full_name || null, parent_email: primary?.email || null,
        }
      }))

      setOffers(offerRows || [])
      if (offerRows?.length) loadOfferIntoDraft(offerRows[0])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const setField = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true) }
  const toggleInList = (k, val) => setField(k, draft[k].includes(val) ? draft[k].filter(x => x !== val) : [...draft[k], val])

  // ── Offer CRUD ───────────────────────────────────────────────────────────────
  const newOffer = async () => {
    const { data, error: err } = await supabase.from(T_COURSE_OFFERS).insert({ ...BLANK(), created_by: profile?.full_name }).select('*').single()
    if (err) { setError(err.message); return }
    setOffers(prev => [data, ...prev]); loadOfferIntoDraft(data)
  }
  const saveOffer = async () => {
    if (!currentId) return
    setSaving(true); setError(null)
    const patch = { ...draft, updated_at: new Date().toISOString() }
    const { error: err } = await supabase.from(T_COURSE_OFFERS).update(patch).eq('id', currentId)
    setSaving(false)
    if (err) { setError(err.message); return }
    setOffers(prev => prev.map(o => o.id === currentId ? { ...o, ...patch } : o))
    setDirty(false)
  }
  const deleteOffer = async () => {
    if (!currentId || !confirm('Delete this course offer?')) return
    const { error: err } = await supabase.from(T_COURSE_OFFERS).delete().eq('id', currentId)
    if (err) { setError(err.message); return }
    const rest = offers.filter(o => o.id !== currentId)
    setOffers(rest)
    if (rest.length) loadOfferIntoDraft(rest[0]); else { setCurrentId(''); setDraft(BLANK()) }
  }

  // ── Recipients ───────────────────────────────────────────────────────────────
  const matchingFamilies = useMemo(() => {
    const yrs = (draft.year_levels || []).map(Number)
    const req = draft.requires_subjects || []
    const exc = draft.excludes_subjects || []
    const matched = students.filter(s => {
      if (yrs.length && !yrs.includes(Number(s.year))) return false
      const subs = s.subjects
      if (req.length && !req.every(r => subs.includes(r))) return false
      if (exc.length && exc.some(x => subs.includes(x))) return false
      return true
    })
    const map = {}
    for (const s of matched) {
      const key = familyKeyFor(s)
      if (!map[key]) map[key] = { key, parent_name: s.parent_name, parent_email: s.parent_email, students: [] }
      map[key].students.push(s.full_name)
      if (!map[key].parent_email && s.parent_email) { map[key].parent_email = s.parent_email; map[key].parent_name = s.parent_name }
    }
    return Object.values(map)
      .map(f => ({ ...f, student_names: f.students.map(n => n.split(' ')[0]).join(' & ') }))
      .sort((a, b) => (a.parent_name || 'zz').localeCompare(b.parent_name || 'zz'))
  }, [students, draft.year_levels, draft.requires_subjects, draft.excludes_subjects])

  const selected = useMemo(
    () => matchingFamilies.filter(f => f.parent_email && !unchecked.has(f.key)),
    [matchingFamilies, unchecked])
  const noEmailCount = matchingFamilies.filter(f => !f.parent_email).length

  const previewHtml = useMemo(
    () => buildCourseOfferEmailHtml(draft.body, { parentName: selected[0]?.parent_name || 'there', studentNames: selected[0]?.student_names || 'your child' }),
    [draft.body, selected])

  // ── Send ─────────────────────────────────────────────────────────────────────
  const post = (payload) => authedFetch('/api/send-course-offer-emails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: draft.email_subject, body: draft.body, ...payload }),
  })
  const sendTest = async () => {
    setTesting(true); setError(null); setTestSentTo(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email || profile?.email
      if (!email) throw new Error('Could not determine your email address.')
      const res = await post({ test: true, testEmail: email })
      const b = await res.json(); if (!res.ok) throw new Error(b.error || 'Test send failed')
      setTestSentTo(email)
    } catch (e) { setError(e.message) } finally { setTesting(false) }
  }
  const sendAll = async () => {
    setConfirmSend(false); setSending(true); setError(null); setResults(null)
    try {
      const res = await post({ families: selected.map(f => ({ parent_name: f.parent_name, parent_email: f.parent_email, student_names: f.student_names })) })
      const b = await res.json(); if (!res.ok) throw new Error(b.error || 'Send failed')
      setResults(b)
    } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  const canSend = draft.email_subject.trim() && draft.body.trim() && selected.length > 0

  // ── Render ───────────────────────────────────────────────────────────────────
  const pill = (active) => `text-xs font-semibold px-2.5 py-1 rounded-full border transition ${active ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/tutor/emails" className="text-sm text-[#325099] hover:underline">← Emails</Link>
        </div>
        <h1 className="text-2xl font-bold text-[#062E63]">Course Offers</h1>
        <p className="text-sm text-[#325099]/60 mt-1 mb-6">Promote a course to a targeted cohort — pick who, write the pitch, preview, test, then send. One email per family.</p>

        {error && <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-2">{error}</div>}

        {/* Offer picker */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <select value={currentId} onChange={e => { const o = offers.find(x => x.id === e.target.value); if (o) loadOfferIntoDraft(o) }}
            className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-semibold text-[#062E63] bg-white max-w-[280px]">
            {offers.length === 0 && <option value="">No offers yet</option>}
            {offers.map(o => <option key={o.id} value={o.id}>{o.name || 'Untitled offer'}</option>)}
          </select>
          <button onClick={newOffer} className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#062E63] border-[#DEE7FF] hover:border-[#325099]">+ New offer</button>
          {currentId && (
            <>
              <button onClick={saveOffer} disabled={saving || !dirty}
                className="text-sm font-semibold rounded-xl px-4 py-2 border bg-[#325099] text-white border-[#325099] hover:bg-[#062E63] disabled:opacity-50">
                {saving ? 'Saving…' : dirty ? 'Save offer' : 'Saved ✓'}
              </button>
              <button onClick={deleteOffer} className="text-sm font-semibold rounded-xl px-3 py-2 border bg-white text-[#B23A3A] border-[#F3C0C0] hover:bg-[#FFF5F5]">Delete</button>
            </>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[#2A2035]/40 py-12 text-center animate-pulse">Loading…</p>
        ) : !currentId ? (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center text-sm text-[#325099]/50">
            Create your first course offer to get started.
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-5">
            {/* Left: definition */}
            <div className="space-y-5">
              {/* Audience */}
              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                <p className="text-xs font-bold text-[#062E63] mb-3">Audience</p>
                <label className="block text-[11px] font-semibold text-[#325099] mb-1">Offer name (internal)</label>
                <input value={draft.name} onChange={e => setField('name', e.target.value)}
                  className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:border-[#325099]" />

                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Year levels <span className="font-normal text-[#325099]/50">(none = all years)</span></p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {OFFER_YEARS.map(y => (
                    <button key={y} onClick={() => toggleInList('year_levels', y)} className={pill(draft.year_levels.includes(y))}>Y{y}</button>
                  ))}
                </div>

                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Currently studies <span className="font-normal text-[#325099]/50">(must do all selected)</span></p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {OFFER_SUBJECTS.map(s => (
                    <button key={s} onClick={() => toggleInList('requires_subjects', s)} className={pill(draft.requires_subjects.includes(s))}>{s}</button>
                  ))}
                </div>

                <p className="text-[11px] font-semibold text-[#325099] mb-1.5">Does NOT study <span className="font-normal text-[#325099]/50">(exclude — put the offered subject here)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {OFFER_SUBJECTS.map(s => (
                    <button key={s} onClick={() => toggleInList('excludes_subjects', s)} className={pill(draft.excludes_subjects.includes(s))}>{s}</button>
                  ))}
                </div>
              </section>

              {/* Content */}
              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                <p className="text-xs font-bold text-[#062E63] mb-3">Email content</p>
                <label className="block text-[11px] font-semibold text-[#325099] mb-1">Subject line</label>
                <input value={draft.email_subject} onChange={e => setField('email_subject', e.target.value)}
                  placeholder="e.g. A great fit for {{student_names}} — try Chemistry this term"
                  className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:border-[#325099]" />
                <label className="block text-[11px] font-semibold text-[#325099] mb-1">Body <span className="font-normal text-[#325099]/50">· placeholders: {'{{parent_name}}'}, {'{{student_names}}'} · **bold**</span></label>
                <textarea value={draft.body} onChange={e => setField('body', e.target.value)} rows={16}
                  className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm leading-relaxed font-mono focus:outline-none focus:border-[#325099] resize-y" />
              </section>
            </div>

            {/* Right: recipients + preview + send */}
            <div className="space-y-5">
              <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 flex items-center justify-between">
                  <p className="text-xs font-bold text-[#062E63]">Recipients — {selected.length} of {matchingFamilies.length}</p>
                  {matchingFamilies.length > 0 && (
                    <div className="flex gap-2 text-[10px] font-semibold">
                      <button onClick={() => setUnchecked(new Set())} className="text-[#325099] hover:underline">All</button>
                      <button onClick={() => setUnchecked(new Set(matchingFamilies.map(f => f.key)))} className="text-[#325099] hover:underline">None</button>
                    </div>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#F0F4FF]">
                  {matchingFamilies.length === 0 ? (
                    <p className="text-center text-xs text-[#2A2035]/40 py-8">No students match this audience.</p>
                  ) : matchingFamilies.map(f => (
                    <label key={f.key} className={`flex items-start gap-2.5 px-4 py-2 cursor-pointer ${!f.parent_email ? 'opacity-50' : ''}`}>
                      <input type="checkbox" disabled={!f.parent_email} checked={!!f.parent_email && !unchecked.has(f.key)}
                        onChange={() => setUnchecked(prev => { const n = new Set(prev); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n })}
                        className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-[#062E63] truncate">{f.parent_name || f.students[0]}</span>
                        <span className="block text-[10px] text-[#2A2035]/45 truncate">{f.students.join(', ')}{f.parent_email ? ` · ${f.parent_email}` : ' · no email'}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {noEmailCount > 0 && <p className="px-4 py-2 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-100">{noEmailCount} matching famil{noEmailCount === 1 ? 'y has' : 'ies have'} no email and can't be sent to.</p>}
              </section>

              <section className="bg-white rounded-2xl border border-[#DEE7FF] p-4">
                <p className="text-xs font-bold text-[#062E63] mb-2">Preview</p>
                <iframe srcDoc={previewHtml} title="preview" className="w-full h-72 border border-[#EEF2FB] rounded-xl bg-white" />
              </section>

              <div className="flex flex-col gap-2">
                {testSentTo && <p className="text-xs text-emerald-700">Test sent to {testSentTo}.</p>}
                <div className="flex gap-2">
                  <button onClick={sendTest} disabled={testing || !draft.body.trim() || !draft.email_subject.trim()}
                    className="flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 border bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] hover:bg-[#FEF3C7] disabled:opacity-40">
                    {testing ? 'Testing…' : '🧪 Test to me'}
                  </button>
                  <button onClick={() => setConfirmSend(true)} disabled={sending || !canSend}
                    className="flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 border bg-[#062E63] text-white border-[#062E63] hover:bg-[#325099] disabled:opacity-40">
                    {sending ? 'Sending…' : `✉ Send to ${selected.length}`}
                  </button>
                </div>
                {dirty && <p className="text-[11px] text-amber-700">You have unsaved changes — save the offer before sending so the audience/content stick.</p>}
              </div>

              {results && (
                <div className="bg-white rounded-2xl border border-[#DEE7FF] p-4 text-sm">
                  <p className="font-semibold text-[#062E63] mb-1">Sent {results.successCount}/{results.total}.</p>
                  {results.results?.filter(r => !r.success).map((r, i) => (
                    <p key={i} className="text-xs text-rose-600">{r.email || r.family}: {r.error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {confirmSend && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setConfirmSend(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] p-6 w-[24rem]" onClick={e => e.stopPropagation()}>
            <p className="text-lg font-bold text-[#062E63] mb-2">Send course offer?</p>
            <p className="text-sm text-[#2A2035]/70 mb-1">“{draft.name}” will email <strong>{selected.length}</strong> famil{selected.length === 1 ? 'y' : 'ies'}.</p>
            <p className="text-xs text-[#2A2035]/50 mb-5">Subject: {draft.email_subject || '(none)'}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmSend(false)} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 border border-[#DEE7FF] text-[#325099]">Cancel</button>
              <button onClick={sendAll} className="flex-1 text-sm font-semibold rounded-xl px-4 py-2 bg-[#062E63] text-white hover:bg-[#325099]">Send now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
