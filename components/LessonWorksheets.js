'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_WORKSHEETS } from '../lib/tables'
import { loadWorksheetQuestions, worksheetQuestionIds } from '../lib/qbank'
import { exportWorksheet } from '../lib/qbankWorksheet'
import SearchSelectPopover from './SearchSelectPopover'
import PdfPreviewModal from './qbank/PdfPreviewModal'

/*
 * <LessonWorksheets cls={...} dateISO="2026-09-08" staff={...} isAdmin={bool} readOnly={bool} />
 *
 * Additional-questions worksheets assigned to one lesson (class + date), for
 * the teacher to open as PDFs — the worksheet and its answer key. Rows live in
 * lesson_worksheets; the PDFs are SNAPSHOTS rendered in the assigning admin's
 * browser at assign time and stored in the private lesson-worksheets bucket,
 * so a later edit to the worksheet doesn't change what the teacher sees. To
 * refresh, remove and assign again.
 *
 * Admins assign and remove; every teacher on the lesson can view.
 */

const BUCKET = 'lesson-worksheets'
const TABLE = 'lesson_worksheets'

// "Y8 Maths" / "Year 10 Adv" → 8 / 10, to rank the picker's options.
const yearOfClass = (name) => { const m = /\b(?:Y|Yr|Year)\s?(\d{1,2})\b/i.exec(name || ''); return m ? Number(m[1]) : null }

export default function LessonWorksheets({ cls, dateISO, staff, isAdmin, readOnly }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [pop, setPop] = useState(null)          // picker anchor rect
  const [options, setOptions] = useState(null)  // picker options, fetched on first open
  const [wsById, setWsById] = useState({})
  const [busy, setBusy] = useState('')          // progress text while assigning
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState(null)    // { url, downloadUrl, filename, title }

  const classId = cls?.id
  const fetchRows = (cid, d) => supabase.from(TABLE).select('*')
    .eq('class_id', String(cid)).eq('lesson_date', d).order('created_at')
  useEffect(() => {
    if (!classId || !dateISO) return
    let dead = false
    fetchRows(classId, dateISO).then(({ data }) => { if (!dead) { setRows(data || []); setLoading(false) } })
    return () => { dead = true }
  }, [classId, dateISO])
  // After an assign/remove.
  const load = async () => { const { data } = await fetchRows(classId, dateISO); setRows(data || []) }

  // Every saved worksheet, labelled by where it's filed, the class's own year first.
  const openPicker = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!options) {
      const [{ data: ws }, { data: topics }, { data: subjects }] = await Promise.all([
        supabase.from(T_QBANK_WORKSHEETS).select('id, title, topic_id, cover_year, question_ids, include_marks, section_breaks, updated_at').order('title'),
        supabase.from(T_QBANK_TOPICS).select('id, name, subject_id'),
        supabase.from(T_QBANK_SUBJECTS).select('id, name, year_level'),
      ])
      const topicById = Object.fromEntries((topics || []).map((t) => [t.id, t]))
      const subjectById = Object.fromEntries((subjects || []).map((s) => [s.id, s]))
      const classYear = yearOfClass(cls?.class_name)
      const list = (ws || []).map((w) => {
        const t = topicById[w.topic_id], s = t ? subjectById[t.subject_id] : null
        const year = w.cover_year ?? s?.year_level ?? null
        const n = worksheetQuestionIds(w).length
        const where = s ? `Year ${year} · ${s.name} · ${t.name}` : 'Unfiled'
        return { value: w.id, label: w.title || 'Untitled worksheet', sub: `${where} · ${n} question${n === 1 ? '' : 's'}`, _year: year, _cover: s ? { year, subject: s.name } : { year: year ?? '', subject: '' }, _n: n }
      }).filter((o) => o._n > 0)
        .sort((a, b) => ((b._year === classYear) - (a._year === classYear)) || a.label.localeCompare(b.label))
      setOptions(list)
      setWsById(Object.fromEntries((ws || []).map((w) => [w.id, { ...w, _cover: list.find((o) => o.value === w.id)?._cover }])))
    }
    setPop(rect)
  }

  // Render both PDFs here, store them, record the assignment.
  const assign = async (worksheetId) => {
    setPop(null)
    const ws = wsById[worksheetId]
    if (!ws) return
    setError('')
    try {
      setBusy('Loading questions…')
      const questions = await loadWorksheetQuestions(ws)
      if (!questions.length) throw new Error('That worksheet has no questions.')
      const common = { title: ws.title || 'Worksheet', questions, includeMarks: ws.include_marks ?? true, cover: ws._cover, breaks: Array.isArray(ws.section_breaks) ? ws.section_breaks : [], output: 'blob' }
      setBusy('Rendering worksheet…')
      const sheet = await exportWorksheet({ ...common, answers: false })
      setBusy('Rendering answer key…')
      const key = await exportWorksheet({ ...common, answers: true })
      setBusy('Saving…')
      const base = `${cls.id}/${dateISO}/${Date.now()}-${sheet.filename.replace(/\.pdf$/, '')}`
      const paths = { worksheet: `${base}.pdf`, answers: `${base}-answers.pdf` }
      for (const [k, blob] of [['worksheet', sheet.blob], ['answers', key.blob]]) {
        const { error: ue } = await supabase.storage.from(BUCKET).upload(paths[k], blob, { contentType: 'application/pdf', upsert: false })
        if (ue) throw new Error(ue.message)
      }
      const { error: ie } = await supabase.from(TABLE).insert({
        class_id: String(cls.id), lesson_date: dateISO, worksheet_id: ws.id, title: ws.title || 'Worksheet',
        worksheet_path: paths.worksheet, answers_path: paths.answers, assigned_by: staff?.full_name || null,
      })
      if (ie) throw new Error(ie.message)
      await load()
    } catch (e) {
      setError('Could not assign the worksheet: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  const view = async (row, answers) => {
    const path = answers ? row.answers_path : row.worksheet_path
    const filename = `${row.title}${answers ? ' — answers' : ''}.pdf`
    const [{ data: v }, { data: d }] = await Promise.all([
      supabase.storage.from(BUCKET).createSignedUrl(path, 600),
      supabase.storage.from(BUCKET).createSignedUrl(path, 600, { download: filename }),
    ])
    if (!v?.signedUrl) { setError('Could not load the PDF. Please try again.'); return }
    setViewer({ url: v.signedUrl, downloadUrl: d?.signedUrl || v.signedUrl, filename, title: filename })
  }

  const remove = async (row) => {
    if (!confirm(`Remove "${row.title}" from this lesson? The stored PDFs are deleted too.`)) return
    await supabase.storage.from(BUCKET).remove([row.worksheet_path, row.answers_path])
    await supabase.from(TABLE).delete().eq('id', row.id)
    load()
  }

  const canAssign = isAdmin && !readOnly
  const btn = 'text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition'

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
      {loading ? (
        <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#2A2035]/50">No additional questions assigned to this lesson{canAssign ? ' yet' : ''}.</p>
      ) : (
        <ul className="divide-y divide-[#F0F4FF]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 flex-wrap">
              <span className="text-lg" aria-hidden>📝</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2A2035] truncate">{r.title}</p>
                <p className="text-[11px] text-[#2A2035]/40">
                  {r.assigned_by ? `Assigned by ${r.assigned_by}` : 'Assigned'}
                  {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}
                </p>
              </div>
              <button onClick={() => view(r, false)} className={`${btn} bg-[#325099] text-white border-[#325099] hover:bg-[#062E63]`}>Worksheet</button>
              <button onClick={() => view(r, true)} className={`${btn} bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]`}>Answers</button>
              {canAssign && <button onClick={() => remove(r)} className="text-[11px] text-[#DC2626] hover:underline">Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {canAssign && (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button onClick={openPicker} disabled={!!busy}
            className="px-3.5 py-2 rounded-xl border border-dashed border-[#BACBFF] text-xs font-semibold text-[#325099] hover:bg-[#F5F8FF] transition disabled:opacity-50">
            {busy ? busy : '+ Assign additional questions'}
          </button>
          {!busy && <span className="text-[11px] text-[#2A2035]/40">The worksheet and answer key are saved as PDFs the moment you assign.</span>}
        </div>
      )}
      {error && <p className="mt-3 text-xs text-[#DC2626]">{error}</p>}
      {pop && options && (
        <SearchSelectPopover anchor={pop} options={options} currentValue={null} placeholder="Search worksheets…"
          onSelect={assign} onClose={() => setPop(null)} />
      )}
      {viewer && (
        <PdfPreviewModal url={viewer.url} downloadUrl={viewer.downloadUrl} filename={viewer.filename} title={viewer.title} onClose={() => setViewer(null)} />
      )}
    </div>
  )
}
