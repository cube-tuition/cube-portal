'use client'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import TutorNav from '../../../../components/TutorNav'
import { subjectCode } from '../../../../lib/format'
import { loadLevelTestItems, loadLevelTestMarks, saveLevelTestMark } from '../../../../lib/levelTest'
import { computeExamAnalysis } from '../../../../lib/examMarking'
import StudentExamAnalysisView, { studentAnalysisRows } from '../../../../components/StudentExamAnalysisView'
import { exportLevelTestReport } from '../../../../lib/levelTestReport'
import { renderLevelTestEmail, levelTestEmailSubject, levelTestEmailHtml, DEFAULT_LEVEL_TEST_TEMPLATE, LEVEL_TEST_EMAIL_KEY } from '../../../../lib/levelTestEmail'

/*
 * Level-test lesson page — a lesson can link to several level tests. Each test
 * shows its own questions to mark and its own topical analysis (drawn from the
 * question bank's topics). Marks are namespaced per build ("<buildId>::<blockId>")
 * so question ids never collide across tests. The feedback PDF gets one section
 * per test.
 */

// Which test this is — every level-test build is titled just "Level Test", so
// the year + subject prefix is what actually identifies it ("9.M. Level Test").
const testName = (b) => {
  const code = subjectCode(b?.subject)
  return (b?.year && code) ? `${b.year}.${code}. Level Test` : (b?.title || 'Level Test')
}

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

  useEffect(() => {
    getAuthProfile().then(async ({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: les, error: lerr } = await supabase.from('lessons')
        .select('id, lesson_date, start_time, end_time, room, notes, lesson_type, makeup_student_id, student_name, scheduled_teacher_id, level_test_build_id, level_test_build_ids, report_comment')
        .eq('id', id).maybeSingle()
      if (lerr) throw lerr
      if (!les) { setError('Lesson not found.'); setLoading(false); return }
      setLesson(les)
      setComment(les.report_comment || '')
      const { data: tpl } = await supabase.from('portal_settings')
        .select('value').eq('key', LEVEL_TEST_EMAIL_KEY).maybeSingle()
      if (tpl?.value?.trim()) setTemplate(tpl.value)

      if (les.makeup_student_id) {
        const { data: st } = await supabase.from('students').select('id, full_name, year').eq('id', les.makeup_student_id).maybeSingle()
        setStudent(st || null)
        if (st) {
          const { data: gs } = await supabase.from('guardians').select('full_name, email').eq('student_id', st.id)
          setGuardian((gs || []).find(g => g.email) || gs?.[0] || null)
        }
      } else if (les.student_name) {
        setStudent({ id: `lt-${les.id}`, full_name: les.student_name, year: null })
        setGuardian(null)
      }

      // Linked level tests (array, falling back to the legacy single column).
      const buildIds = (Array.isArray(les.level_test_build_ids) && les.level_test_build_ids.length)
        ? les.level_test_build_ids
        : (les.level_test_build_id ? [les.level_test_build_id] : [])

      if (buildIds.length) {
        const { data: bs } = await supabase.from('booklet_builds').select('id, title, subject, year, blocks').in('id', buildIds)
        const byId = Object.fromEntries((bs || []).map(b => [b.id, b]))
        const out = []
        for (const bid of buildIds) {              // preserve the chosen order
          const b = byId[bid]
          if (!b) continue
          const raw = await loadLevelTestItems(Array.isArray(b.blocks) ? b.blocks : [])
          // Namespace each item id by its build so marks never collide across tests.
          const items = raw.map(it => ({ ...it, qid: `${b.id}::${it.qid}` }))
          out.push({ build: b, items })
        }
        setTests(out)
      } else {
        setTests([])
      }

      const mm = await loadLevelTestMarks(id)
      setMarks(mm)
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
  const testViews = useMemo(() => tests.map(t => {
    const analysis = computeExamAnalysis(t.items, { [studentId]: marks }, [{ id: studentId }])
    const v = studentAnalysisRows(analysis, studentId)
    return { build: t.build, items: t.items, view: v }
  }), [tests, marks, studentId])

  const allItems = useMemo(() => tests.flatMap(t => t.items), [tests])
  const markedCount = allItems.filter(it => { const a = marks[it.qid]; return a !== '' && a != null }).length

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
  const emailPreview = () => ({
    to: guardian?.email || '(parent email — asked for when sending)',
    subject: levelTestEmailSubject({ studentName: student?.full_name, testTitle: emailTestTitle() }),
    body: renderLevelTestEmail(template, { studentName: student?.full_name, testTitle: emailTestTitle(), comment, teacherName: profile?.full_name }),
  })

  const saveTemplate = async () => {
    setTemplateSaving(true)
    const value = editingTemplate.trim() ? editingTemplate : DEFAULT_LEVEL_TEST_TEMPLATE
    const { error: e } = await supabase.from('portal_settings')
      .upsert({ key: LEVEL_TEST_EMAIL_KEY, value }, { onConflict: 'key' })
    setTemplateSaving(false)
    if (e) { setToast('Template not saved: ' + e.message); return }
    setTemplate(value)
    setEditingTemplate(null)
    setToast('Template saved — it now applies to every level-test email.')
  }

  const reportArgs = () => ({
    student, guardian, lesson, teacherName: profile?.full_name,
    tests: testViews.map(tv => ({
      title: testName(tv.build),
      rows: tv.view.rows, overall: tv.view.overall, sections: tv.view.sections,
      strengths: tv.view.strengths, weaknesses: tv.view.weaknesses,
    })),
  })

  const downloadReport = async () => {
    setReporting(true)
    try { await exportLevelTestReport(reportArgs(), { preview: false }) }
    catch (e) { setToast('Report failed: ' + (e.message || e)) }
    finally { setReporting(false) }
  }

  const emailReport = async () => {
    const to = guardian?.email || (typeof window !== 'undefined' ? window.prompt('Parent email address:') : '')
    if (!to) { setToast('No email address provided.'); return }
    if (!confirm(`Email this level test report to ${guardian?.full_name || to}?`)) return
    setEmailing(true)
    try {
      const { base64, filename } = await exportLevelTestReport(reportArgs(), { base64: true })
      const res = await authedFetch('/api/send-level-test-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lesson_id: id,
          email_to: to,
          student_name: student?.full_name,
          test_title: emailTestTitle(),
          comment,
          teacher_name: profile?.full_name,
          email_subject: emailPreview().subject,
          email_body: emailPreview().body,
          pdf_base64: base64,
          pdf_filename: filename,
        }),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error || 'Email failed')
      setToast('Report emailed to ' + to)
    } catch (e) {
      setToast('Email failed: ' + (e.message || e))
    } finally {
      setEmailing(false)
    }
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
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={downloadReport} disabled={reporting || markedCount === 0}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-2 rounded-full hover:bg-[#F0F4FF] transition disabled:opacity-40">
                  {reporting ? 'Generating…' : '↓ Download PDF'}
                </button>
                <button onClick={() => setEditingTemplate(template)}
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
                  {emailing ? 'Sending…' : '✉ Email to parent'}
                </button>
              </div>
            </div>

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
                      <p><span className="font-bold text-[#325099]/70 uppercase tracking-wider text-[9px] mr-2">Attached</span>Feedback report PDF</p>
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
                <p className="text-base font-bold text-[#062E63]">Email template</p>
                <p className="text-[11px] text-[#2A2035]/50 mt-0.5">One template for every level-test feedback email — saving applies portal-wide.</p>
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
                {['{{first_name}}', '{{student_name}}', '{{test_title}}', '{{teacher_name}}', '{{comment}}'].map(ph => (
                  <code key={ph} className="bg-[#F0F4FF] text-[#325099] rounded px-1.5 py-0.5 mr-1.5 text-[10px]">{ph}</code>
                ))}
                — <code className="bg-[#F0F4FF] text-[#325099] rounded px-1.5 py-0.5 text-[10px]">{'{{comment}}'}</code> is the box on the marking page, and its paragraph disappears when left empty.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-[#F0F4FF] flex items-center justify-between gap-3">
              <button onClick={() => setEditingTemplate(DEFAULT_LEVEL_TEST_TEMPLATE)}
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
