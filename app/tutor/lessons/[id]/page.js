'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import TutorNav from '../../../../components/TutorNav'
import { saveLevelTestMark, loadLevelTestLesson, levelTestViews, levelTestReportArgs, levelTestName, markedCountOf, findSiblingLevelTests } from '../../../../lib/levelTest'
import StudentExamAnalysisView from '../../../../components/StudentExamAnalysisView'
import { exportLevelTestReport } from '../../../../lib/levelTestReport'
import {
  renderLevelTestEmail, levelTestEmailSubject, levelTestEmailHtml, DEFAULT_LEVEL_TEST_TEMPLATE, LEVEL_TEST_EMAIL_KEY,
  renderLevelTestFamilyEmail, levelTestFamilySubject, DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE, LEVEL_TEST_FAMILY_EMAIL_KEY,
} from '../../../../lib/levelTestEmail'

/*
 * Level-test lesson page — a lesson can link to several level tests. Each test
 * shows its own questions to mark and its own topical analysis (drawn from the
 * question bank's topics). Marks are namespaced per build ("<buildId>::<blockId>")
 * so question ids never collide across tests. The feedback PDF gets one section
 * per test.
 *
 * FAMILY EMAIL — brothers and sisters who sat level tests around the same time
 * (same parent email, lessons within a fortnight) are listed here, ticked by
 * default, and go out as ONE email with a report per child rather than one
 * email each. Either child's page can send it; every lesson in the send is
 * stamped, so the other page shows it has already gone.
 */

const testName = levelTestName

const fmtDate = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }
const fmtTime = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}` }

export default function LevelTestLessonPage() {
  const router = useRouter()
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [lesson, setLesson] = useState(null)
  const [student, setStudent] = useState(null)
  const [guardian, setGuardian] = useState(null)
  const [tests, setTests] = useState([])          // [{ build, items }] (items qid namespaced)
  const [marks, setMarks] = useState({})          // { "<buildId>::<blockId>": awarded(string) }
  const [savingId, setSavingId] = useState(null)
  const [emailing, setEmailing] = useState(false)
  const [comment, setComment] = useState('')            // teacher's note to the parents, lives in the email body
  const [commentState, setCommentState] = useState('idle')  // idle | saving | saved
  const [previewOpen, setPreviewOpen] = useState(false)
  const commentTimer = useRef(null)
  const commentRef = useRef(null)
  const [template, setTemplate] = useState(DEFAULT_LEVEL_TEST_TEMPLATE)
  const [editingTemplate, setEditingTemplate] = useState(null)   // draft text while the editor is open
  const [templateSaving, setTemplateSaving] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [toast, setToast] = useState(null)
  const [familyTemplate, setFamilyTemplate] = useState(DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE)
  const [siblings, setSiblings] = useState([])           // [{ lesson, student, data }] — data = loadLevelTestLesson()
  const [familyPick, setFamilyPick] = useState({})       // lesson id → included in the family email

  useEffect(() => {
    getAuthProfile().then(async ({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const got = await loadLevelTestLesson(id)
      if (!got) { setError('Lesson not found.'); setLoading(false); return }
      setLesson(got.lesson)
      setComment(got.lesson.report_comment || '')
      setStudent(got.student)
      setGuardian(got.guardian)
      setTests(got.tests)
      setMarks(got.marks)

      const { data: tpls } = await supabase.from('portal_settings')
        .select('key, value').in('key', [LEVEL_TEST_EMAIL_KEY, LEVEL_TEST_FAMILY_EMAIL_KEY])
      for (const t of tpls || []) {
        if (!t.value?.trim()) continue
        if (t.key === LEVEL_TEST_EMAIL_KEY) setTemplate(t.value)
        if (t.key === LEVEL_TEST_FAMILY_EMAIL_KEY) setFamilyTemplate(t.value)
      }

      // Brothers and sisters tested around the same time, each loaded in full
      // so their reports can go in the same email. A sibling that fails to
      // load is simply not offered — this child's own report still works.
      const sibs = await findSiblingLevelTests({ lesson: got.lesson, student: got.student, guardianEmail: got.guardian?.email })
      const full = (await Promise.all(sibs.map(async (sb) => {
        try { return { ...sb, data: await loadLevelTestLesson(sb.lesson.id) } } catch { return null }
      }))).filter(sb => sb?.data)
      setSiblings(full)
      setFamilyPick(Object.fromEntries(full.map(sb => [sb.lesson.id, true])))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { if (ready) load() }, [ready, load])

  const setMark = (qid, max, raw) => {
    let v = raw
    if (v !== '') {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return
      if (max && n > max) v = String(max)
    }
    setMarks(m => ({ ...m, [qid]: v }))
  }
  const commitMark = async (qid, value) => {
    setSavingId(qid)
    try { await saveLevelTestMark(id, qid, value) }
    catch { setToast('Save failed — try again.') }
    finally { setSavingId(null) }
  }

  const studentId = student?.id || '__s'

  // Per-test analysis (one StudentExamAnalysisView per test, one PDF section per test).
  const testViews = useMemo(() => levelTestViews(tests, marks, studentId), [tests, marks, studentId])
  const markedCount = markedCountOf(tests, marks)

  // The children in this send: this one first, then each ticked sibling.
  // A sibling's comment and marks are read as they were when this page
  // loaded — they are edited on that child's own page.
  const pickedSiblings = siblings.filter(sb => familyPick[sb.lesson.id])
  const isFamily = pickedSiblings.length > 0
  const sendChildren = () => [
    { lesson, student, guardian, tests, marks, comment },
    ...pickedSiblings.map(sb => ({ ...sb.data, comment: sb.data.lesson.report_comment || '' })),
  ]

  // The comment autosaves like a mark — typed once, kept with the lesson.
  // Cmd/Ctrl-B on the comment box wraps the selection in ** **, and unwraps it
  // if it is already wrapped. The markers are the storage format; they never
  // reach the parent — the email turns them into <strong> and strips them from
  // its plain-text copy.
  const onCommentKeyDown = (e) => {
    if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b')) return
    e.preventDefault()
    const el = commentRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    if (a === b) return
    const picked = value.slice(a, b)
    const wrapped = picked.startsWith('**') && picked.endsWith('**') && picked.length > 4
    const next = wrapped
      ? value.slice(0, a) + picked.slice(2, -2) + value.slice(b)
      : value.slice(0, a) + `**${picked}**` + value.slice(b)
    saveComment(next)
    // Keep the same words selected so the shortcut toggles. Wrapping adds two
    // markers before the selection and two after; unwrapping removes all four.
    const [from, to] = wrapped ? [a, b - 4] : [a + 2, b + 2]
    requestAnimationFrame(() => el.setSelectionRange(from, to))
  }

  const saveComment = (v) => {
    setComment(v)
    setCommentState('saving')
    clearTimeout(commentTimer.current)
    commentTimer.current = setTimeout(async () => {
      const { error: e } = await supabase.from('lessons')
        .update({ report_comment: v.trim() || null }).eq('id', id)
      setCommentState(e ? 'idle' : 'saved')
      if (e) setToast('Comment not saved: ' + e.message)
    }, 800)
  }
  useEffect(() => () => clearTimeout(commentTimer.current), [])

  const emailTestTitle = () => (tests.length === 1 ? testName(tests[0].build) : `${tests.length} level tests`)
  const reportFilename = (st) => `${(st?.full_name || 'student').trim()} - Level Test Report.pdf`
  const emailPreview = () => {
    const to = guardian?.email || '(parent email — asked for when sending)'
    if (!isFamily) {
      return {
        to,
        subject: levelTestEmailSubject({ studentName: student?.full_name, testTitle: emailTestTitle() }),
        body: renderLevelTestEmail(template, { studentName: student?.full_name, testTitle: emailTestTitle(), comment, teacherName: profile?.full_name }),
        attached: [reportFilename(student)],
      }
    }
    const kids = sendChildren().map(c => ({ studentName: c.student?.full_name, comment: c.comment }))
    return {
      to,
      subject: levelTestFamilySubject(kids),
      body: renderLevelTestFamilyEmail(familyTemplate, { children: kids, teacherName: profile?.full_name }),
      attached: sendChildren().map(c => reportFilename(c.student)),
    }
  }

  // The editor works on whichever template this send will use.
  const saveTemplate = async () => {
    setTemplateSaving(true)
    const [key, fallback, apply] = isFamily
      ? [LEVEL_TEST_FAMILY_EMAIL_KEY, DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE, setFamilyTemplate]
      : [LEVEL_TEST_EMAIL_KEY, DEFAULT_LEVEL_TEST_TEMPLATE, setTemplate]
    const value = editingTemplate.trim() ? editingTemplate : fallback
    const { error: e } = await supabase.from('portal_settings')
      .upsert({ key, value }, { onConflict: 'key' })
    setTemplateSaving(false)
    if (e) { setToast('Template not saved: ' + e.message); return }
    apply(value)
    setEditingTemplate(null)
    setToast(`Template saved — it now applies to every ${isFamily ? 'family ' : ''}level-test email.`)
  }

  const reportArgs = () => levelTestReportArgs({ lesson, student, guardian, tests, marks, teacherName: profile?.full_name })

  const downloadReport = async () => {
    setReporting(true)
    try { await exportLevelTestReport(reportArgs(), { preview: false }) }
    catch (e) { setToast('Report failed: ' + (e.message || e)) }
    finally { setReporting(false) }
  }

  const emailReport = async () => {
    const to = guardian?.email || (typeof window !== 'undefined' ? window.prompt('Parent email address:') : '')
    if (!to) { setToast('No email address provided.'); return }
    const kids = sendChildren()
    // Every linked test needs marks, or its section goes out as "No marks
    // recorded yet" — e.g. Maths marked but English not.
    const unmarked = kids.flatMap(c => c.tests
      .filter(t => markedCountOf([t], c.marks) === 0)
      .map(t => `${(c.student?.full_name || '').split(' ')[0]} — ${testName(t.build)}`))
    if (unmarked.length) { setToast(`Not marked yet: ${unmarked.join(', ')}. Mark it, or untick that child, first.`); return }
    const already = kids.filter(c => c.lesson?.report_emailed_at).map(c => c.student?.full_name)
    const names = kids.map(c => c.student?.full_name).join(', ')
    if (!confirm(
      (isFamily
        ? `Send ONE email to ${guardian?.full_name || to} with ${kids.length} reports (${names})?`
        : `Email this level test report to ${guardian?.full_name || to}?`)
      + (already.length ? `\n\nAlready emailed before: ${already.join(', ')}. This sends again.` : ''))) return

    setEmailing(true)
    try {
      // One PDF per child, built the same way the Download button builds this one.
      const attachments = []
      for (const c of kids) {
        const { base64 } = await exportLevelTestReport(
          levelTestReportArgs({ ...c, teacherName: profile?.full_name }), { base64: true })
        attachments.push({ pdf_base64: base64, pdf_filename: reportFilename(c.student) })
      }
      const pv = emailPreview()
      const res = await authedFetch('/api/send-level-test-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lesson_ids: kids.map(c => c.lesson.id),
          email_to: to,
          student_name: student?.full_name,
          test_title: emailTestTitle(),
          comment,
          teacher_name: profile?.full_name,
          email_subject: pv.subject,
          email_body: pv.body,
          attachments,
        }),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error || 'Email failed')
      setToast(`${kids.length > 1 ? `${kids.length} reports` : 'Report'} emailed to ${to}`
        + (out.stamped === false ? ' — but not recorded as sent' : ''))
      load()   // pick up the sent stamps
    } catch (e) {
      setToast('Email failed: ' + (e.message || e))
    } finally {
      setEmailing(false)
    }
  }

  // "Sent" line for a lesson: when, and who went in the same email.
  const sentNote = (les) => {
    if (!les?.report_emailed_at) return null
    const d = new Date(les.report_emailed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    const nameOf = (lid) => (lid === lesson?.id ? student?.full_name
      : siblings.find(sb => sb.lesson.id === lid)?.student?.full_name)
    const others = (les.report_emailed_with || []).filter(lid => lid !== les.id).map(nameOf).filter(Boolean)
    return `Emailed ${d}${others.length ? ` with ${others.map(n => n.split(' ')[0]).join(' & ')}'s report` : ''}`
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center bg-white"><div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</div></div>

  const headerTests = tests.map(t => testName(t.build)).join(' · ')

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role === 'admin'} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-6xl mx-auto px-6 md:px-10 py-8">
          <button onClick={() => router.back()} className="text-[#325099] text-sm hover:underline mb-2">← Back</button>
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-1">Level Test · Marking</p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#2A2035]">{student?.full_name || 'Student'}</h1>
          <p className="text-sm text-[#2A2035]/60 mt-1">
            {headerTests || 'Level test'}{lesson?.lesson_date ? ` · ${fmtDate(lesson.lesson_date)}` : ''}{lesson?.room ? ` · ${lesson.room}` : ''}
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 md:px-10 py-8">
        {loading ? (
          <p className="text-sm text-[#2A2035]/60">Loading…</p>
        ) : error ? (
          <div className="bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl p-4 text-sm text-[#991B1B]">{error}</div>
        ) : lesson?.lesson_type !== 'level_test' || tests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] p-10 text-center">
            <p className="text-sm font-semibold text-[#2A2035]">No level tests linked to this lesson.</p>
            <p className="text-xs text-[#2A2035]/55 mt-1">Add a level-test lesson and select one or more tests to mark them here.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Report actions */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#062E63]">Parent feedback report</p>
                <p className="text-[11px] text-[#2A2035]/55 mt-0.5">
                  {tests.length} test{tests.length === 1 ? '' : 's'} · {markedCount} question{markedCount === 1 ? '' : 's'} marked · {guardian?.email ? <>emails to <span className="font-semibold">{guardian.full_name || 'parent'}</span></> : 'enter the parent email when sending'}
                </p>
                {sentNote(lesson) && (
                  <p className="text-[11px] font-semibold text-[#065F46] mt-0.5">✓ {sentNote(lesson)}{lesson.report_emailed_to ? ` · ${lesson.report_emailed_to}` : ''}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={downloadReport} disabled={reporting || markedCount === 0}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-2 rounded-full hover:bg-[#F0F4FF] transition disabled:opacity-40">
                  {reporting ? 'Generating…' : '↓ Download PDF'}
                </button>
                <button onClick={() => setEditingTemplate(isFamily ? familyTemplate : template)}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-2 rounded-full hover:bg-[#F0F4FF] transition">
                  ✎ Edit template
                </button>
                <button onClick={() => setPreviewOpen(o => !o)}
                  className={`text-xs font-semibold px-4 py-2 rounded-full border transition ${previewOpen
                    ? 'bg-[#EEF4FF] text-[#062E63] border-[#9DBBF5]'
                    : 'text-[#325099] border-[#DEE7FF] hover:bg-[#F0F4FF]'}`}>
                  {previewOpen ? 'Hide preview' : '👁 Preview email'}
                </button>
                <button onClick={emailReport} disabled={emailing || markedCount === 0}
                  className="text-xs font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-4 py-2 rounded-full transition disabled:opacity-40">
                  {emailing ? 'Sending…' : isFamily ? `✉ Email family (${pickedSiblings.length + 1} reports)` : '✉ Email to parent'}
                </button>
              </div>
            </div>

              {/* Siblings with the same parent, tested around the same time.
                  Ticked ones ride in this email, one report each. */}
              {siblings.length > 0 && (
                <div className="mt-4 rounded-xl border border-[#C7D7FF] bg-[#F5F8FF] px-4 py-3">
                  <p className="text-xs font-bold text-[#062E63]">👪 Same parent — send as one family email</p>
                  <p className="text-[11px] text-[#2A2035]/55 mt-0.5 mb-2">
                    {guardian?.full_name || 'This parent'} also has {siblings.length === 1 ? 'a child' : 'children'} who sat a level test within a fortnight. Ticked children go in the same email, one report each.
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px] text-[#2A2035]/70">
                      <input type="checkbox" checked disabled className="accent-[#062E63]" />
                      <span className="font-semibold text-[#2A2035]">{student?.full_name}</span>
                      <span className="text-[#2A2035]/45">{tests.map(t => testName(t.build)).join(' · ')} · this page</span>
                    </div>
                    {siblings.map(sb => {
                      const n = markedCountOf(sb.data.tests, sb.data.marks)
                      const hasComment = !!(sb.data.lesson.report_comment || '').trim()
                      return (
                        <label key={sb.lesson.id} className="flex flex-wrap items-center gap-2 text-[12px] text-[#2A2035]/70 cursor-pointer">
                          <input type="checkbox" checked={!!familyPick[sb.lesson.id]} className="accent-[#062E63]"
                            onChange={e => setFamilyPick(fp => ({ ...fp, [sb.lesson.id]: e.target.checked }))} />
                          <span className="font-semibold text-[#2A2035]">{sb.student?.full_name}</span>
                          <span className="text-[#2A2035]/45">
                            {sb.data.tests.map(t => testName(t.build)).join(' · ') || 'no tests linked'} · {fmtDate(sb.lesson.lesson_date)}
                          </span>
                          <span className={n ? 'text-[#065F46]' : 'text-[#B45309] font-semibold'}>{n ? `${n} marked` : 'nothing marked'}</span>
                          {!hasComment && <span className="text-[#2A2035]/40">· no comment</span>}
                          {sentNote(sb.lesson) && <span className="text-[#065F46] font-semibold">· {sentNote(sb.lesson)}</span>}
                          <a href={`/tutor/lessons/${sb.lesson.id}`} onClick={e => e.stopPropagation()}
                            className="text-[#325099] font-semibold hover:underline">mark / comment →</a>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Comment to the parents — lands in the email body, between the
                  template and the sign-off. Autosaves with the lesson. */}
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <label className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60">Comment to parents</label>
                  <span className="text-[10px] text-[#2A2035]/40">
                    {commentState === 'saving' ? 'Saving…' : commentState === 'saved' ? '✓ Saved' : 'Shown in the email body · **bold** or ⌘B'}
                  </span>
                </div>
                <textarea
                  ref={commentRef}
                  value={comment}
                  onChange={(e) => saveComment(e.target.value)}
                  onKeyDown={onCommentKeyDown}
                  rows={3}
                  placeholder={`e.g. ${(student?.full_name || 'They').split(' ')[0]} worked carefully through the whole paper — with some practice on the focus areas below, they'll be very well placed…`}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] text-[13px] text-[#2A2035] leading-relaxed placeholder:text-[#2A2035]/30 focus:outline-none focus:border-[#325099] focus:bg-white transition resize-y"
                />
              </div>

              {previewOpen && (() => {
                const pv = emailPreview()
                return (
                  <div className="mt-3 rounded-xl border border-[#DEE7FF] overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#F8FAFF] border-b border-[#EEF2FF] text-[11px] text-[#2A2035]/70 space-y-0.5">
                      <p><span className="font-bold text-[#325099]/70 uppercase tracking-wider text-[9px] mr-2">To</span>{pv.to}</p>
                      <p><span className="font-bold text-[#325099]/70 uppercase tracking-wider text-[9px] mr-2">Subject</span><span className="font-semibold text-[#2A2035]">{pv.subject}</span></p>
                      <p><span className="font-bold text-[#325099]/70 uppercase tracking-wider text-[9px] mr-2">Attached</span>{pv.attached.join(', ')}</p>
                    </div>
                    {/* Rendered through the same helper the send route uses, so
                        the preview and the email cannot disagree. It escapes
                        before formatting, so the body cannot inject markup. */}
                    <div className="px-4 py-3.5 text-[13px] text-[#1a1a1a] leading-relaxed bg-white"
                      dangerouslySetInnerHTML={{ __html: levelTestEmailHtml(pv.body) }} />
                  </div>
                )
              })()}
            </div>

            {/* One block per linked level test */}
            {testViews.map(({ build, items, view }) => {
              const sections = (() => {
                const map = new Map()
                for (const it of items) { if (!map.has(it.section)) map.set(it.section, []); map.get(it.section).push(it) }
                return [...map.entries()]
              })()
              const totalMax = items.reduce((s, it) => s + (it.max || 0), 0)
              const totalAwarded = items.reduce((s, it) => { const a = marks[it.qid]; return s + (a === '' || a == null ? 0 : Number(a) || 0) }, 0)
              return (
                <div key={build.id} className="grid lg:grid-cols-[1fr_minmax(320px,420px)] gap-6 items-start">
                  {/* Marking column */}
                  <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
                    <div className="px-5 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF] flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-[#062E63]">{testName(build)}</p>
                        <p className="text-[11px] text-[#2A2035]/50">{items.filter(it => { const a = marks[it.qid]; return a !== '' && a != null }).length}/{items.length} questions marked</p>
                      </div>
                      <p className="text-sm font-bold text-[#062E63]">{totalAwarded}<span className="text-[#2A2035]/45 font-medium"> / {totalMax}</span></p>
                    </div>
                    {items.length === 0 ? (
                      <p className="px-5 py-8 text-center text-xs text-[#2A2035]/45">This level test has no markable questions. Add questions from the bank in the level test builder.</p>
                    ) : (
                      <div className="divide-y divide-[#F0F4FF]">
                        {sections.map(([sec, its]) => (
                          <div key={sec}>
                            <div className="px-5 py-2 bg-[#FBFCFF] text-[10px] font-bold uppercase tracking-wider text-[#325099]/70">{sec}</div>
                            {its.map(it => {
                              const a = marks[it.qid] ?? ''
                              return (
                                <div key={it.qid} className="flex items-center gap-3 px-5 py-3">
                                  <span className="w-7 text-xs font-bold text-[#062E63] shrink-0">Q{it.n}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-[#2A2035] truncate">{it.stem || <span className="text-[#2A2035]/35 italic">(no text)</span>}</p>
                                    <p className="text-[10px] text-[#2A2035]/45">{it.topic}{it.qtype === 'mcq' ? ' · MCQ' : ''}</p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <input
                                      type="number" min="0" max={it.max || undefined} step="0.5"
                                      value={a}
                                      onChange={e => setMark(it.qid, it.max, e.target.value)}
                                      onBlur={e => commitMark(it.qid, e.target.value)}
                                      className="w-16 text-center border border-[#DEE7FF] rounded-md px-1 py-1.5 text-sm focus:outline-none focus:border-[#325099]"
                                    />
                                    <span className="text-xs text-[#2A2035]/45">/ {it.max}</span>
                                    {savingId === it.qid && <span className="text-[10px] text-[#325099]">…</span>}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Analysis column */}
                  <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
                    <p className="text-sm font-bold text-[#062E63] mb-3">Topical analysis</p>
                    <StudentExamAnalysisView
                      studentName={student?.full_name}
                      rows={view.rows} overall={view.overall} sections={view.sections}
                      strengths={view.strengths} weaknesses={view.weaknesses}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {editingTemplate !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingTemplate(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[#F0F4FF] flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-[#062E63]">{isFamily ? 'Family email template' : 'Email template'}</p>
                <p className="text-[11px] text-[#2A2035]/50 mt-0.5">
                  {isFamily
                    ? 'Used when several children’s reports go in one email — saving applies portal-wide.'
                    : 'One template for every level-test feedback email — saving applies portal-wide.'}
                </p>
              </div>
              <button onClick={() => setEditingTemplate(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              <textarea
                value={editingTemplate}
                onChange={(e) => setEditingTemplate(e.target.value)}
                rows={16}
                className="w-full px-3 py-2.5 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] text-[13px] font-mono text-[#2A2035] leading-relaxed focus:outline-none focus:border-[#325099] focus:bg-white transition resize-y"
              />
              <p className="text-[11px] text-[#2A2035]/50 mt-2 leading-relaxed">
                Placeholders fill in automatically:{' '}
                {(isFamily ? ['{{first_names}}', '{{teacher_name}}', '{{comments}}'] : ['{{first_name}}', '{{student_name}}', '{{test_title}}', '{{teacher_name}}', '{{comment}}']).map(ph => (
                  <code key={ph} className="bg-[#F0F4FF] text-[#325099] rounded px-1.5 py-0.5 mr-1.5 text-[10px]">{ph}</code>
                ))}
                {isFamily
                  ? <>— <code className="bg-[#F0F4FF] text-[#325099] rounded px-1.5 py-0.5 text-[10px]">{'{{comments}}'}</code> is each child’s comment box under their name; children with no comment are left out.</>
                  : <>— <code className="bg-[#F0F4FF] text-[#325099] rounded px-1.5 py-0.5 text-[10px]">{'{{comment}}'}</code> is the box on the marking page, and its paragraph disappears when left empty.</>}
              </p>
            </div>
            <div className="px-6 py-4 border-t border-[#F0F4FF] flex items-center justify-between gap-3">
              <button onClick={() => setEditingTemplate(isFamily ? DEFAULT_LEVEL_TEST_FAMILY_TEMPLATE : DEFAULT_LEVEL_TEST_TEMPLATE)}
                className="text-[11px] font-semibold text-[#2A2035]/45 hover:text-[#B23A3A] transition">Reset to default</button>
              <div className="flex gap-2">
                <button onClick={() => setEditingTemplate(null)}
                  className="text-xs font-semibold text-[#2A2035]/50 px-4 py-2 rounded-full hover:bg-[#F8FAFF] transition">Cancel</button>
                <button onClick={saveTemplate} disabled={templateSaving}
                  className="text-xs font-bold text-white bg-[#062E63] hover:bg-[#325099] px-5 py-2 rounded-full transition disabled:opacity-40">
                  {templateSaving ? 'Saving…' : 'Save template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[#062E63] text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg cursor-pointer" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
