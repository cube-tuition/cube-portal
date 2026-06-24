'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import {
  T_SYLLABUS_MODULES, T_SYLLABUS_TOPICS, T_SYLLABUS_DOTPOINTS,
} from '../../../../lib/tables'
import {
  fetchSyllabus, fetchSyllabusSubjects, fetchDotpointCoverage,
  addModule, addTopic, addDotpoint, renameRow, deleteRow, moveRow,
} from '../../../../lib/syllabus'

/*
 * Syllabus — the master syllabus dotpoint list (Chemistry for now). Each
 * dotpoint is automatically marked "covered" once it's drawn into a booklet's
 * Content tab (no manual ticking). Booklets draw from this list.
 */
export default function SyllabusPointsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [sel, setSel] = useState(null)            // { subject, year }
  const [modules, setModules] = useState([])
  const [coverage, setCoverage] = useState({})    // dotpointId → [booklet titles]
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(false)

  const reload = useCallback(async (s = sel) => {
    if (!s) return
    setLoading(true)
    const [mods, cov] = await Promise.all([fetchSyllabus(s.subject, s.year), fetchDotpointCoverage()])
    setModules(mods); setCoverage(cov)
    setLoading(false)
  }, [sel])

  useEffect(() => {
    getAuthProfile().then(async ({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
      const subs = await fetchSyllabusSubjects()
      setSubjects(subs)
      setSel(subs[0] || { subject: 'Chemistry', year: 11 })
    })
  }, [router])

  useEffect(() => {
    if (!sel) return undefined
    let active = true
    // Defer out of the synchronous effect body so the first setState in reload()
    // doesn't fire during render.
    Promise.resolve().then(() => { if (active) reload(sel) })
    return () => { active = false }
  }, [sel, reload])

  // ── Coverage (auto-derived from which dotpoints are drawn into booklets) ─────
  const isCovered = useCallback((id) => (coverage[id]?.length || 0) > 0, [coverage])
  // Coverable "leaves": lone main dotpoints + every subdotpoint.
  const leaves = useMemo(() => {
    const out = []
    for (const m of modules) for (const t of m.topics) for (const d of t.dotpoints) {
      if (d.subs.length === 0) out.push(d); else for (const s of d.subs) out.push(s)
    }
    return out
  }, [modules])
  const coveredCount = leaves.filter((d) => isCovered(d.id)).length
  const pctCovered = leaves.length ? Math.round((coveredCount / leaves.length) * 100) : 0

  // ── Editing ───────────────────────────────────────────────────────────────
  const onAddModule = async () => {
    const name = (window.prompt('New module name (e.g. "Module 5: …"):') || '').trim()
    if (!name) return
    await addModule(sel.subject, sel.year, name, modules.length); reload()
  }
  const onAddTopic = async (mod) => {
    const name = (window.prompt('New topic name:') || '').trim()
    if (!name) return
    const iq = (window.prompt('Inquiry question (optional):') || '').trim()
    await addTopic(mod.id, name, iq, mod.topics.length); reload()
  }
  const onAddDotpoint = async (topic) => {
    const text = (window.prompt('New dotpoint text:') || '').trim()
    if (!text) return
    await addDotpoint(topic.id, text, null, topic.dotpoints.length); reload()
  }
  const onAddSub = async (topic, main) => {
    const text = (window.prompt('New subdotpoint text:') || '').trim()
    if (!text) return
    await addDotpoint(topic.id, text, main.id, main.subs.length); reload()
  }
  const onRename = async (table, id, field, current) => {
    const v = window.prompt('Edit:', current)
    if (v == null) return
    await renameRow(table, id, { [field]: v }); reload()
  }
  const onDelete = async (table, id, label, hasChildren) => {
    if (!window.confirm(`Delete "${label}"?${hasChildren ? ' This removes everything inside it.' : ''}`)) return
    await deleteRow(table, id); reload()
  }
  const onMove = async (table, list, item, dir) => { await moveRow(table, list, item, dir); reload() }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const ebtn = 'text-[11px] text-[#2A2035]/30 hover:text-[#325099] opacity-0 group-hover:opacity-100'

  // Read-only coverage indicator. Leaves (lone mains + subdotpoints) are covered
  // when drawn into a booklet; a parent main with children shows an aggregate.
  const DotRow = ({ dp, list, table }) => {
    const hasSubs = (dp.subs?.length || 0) > 0
    let covered = false, partial = false, tip = 'Not yet in any booklet'
    if (hasSubs) {
      covered = dp.subs.every((s) => isCovered(s.id))
      partial = !covered && dp.subs.some((s) => isCovered(s.id))
      tip = covered ? 'All subdotpoints drawn into booklets' : partial ? 'Some subdotpoints drawn into booklets' : 'Not yet in any booklet'
    } else {
      const titles = coverage[dp.id] || []
      covered = titles.length > 0
      if (covered) tip = `Covered in: ${[...new Set(titles)].join(', ')}`
    }
    return (
      <div className="group flex items-start gap-2 py-1">
        <span className="mt-0.5 shrink-0 w-4 text-center text-sm leading-5" title={tip}
          style={{ color: covered ? '#16A34A' : partial ? '#F59E0B' : '#CBD5E1' }}>
          {covered ? '✓' : partial ? '◐' : '○'}
        </span>
        <span className={`flex-1 text-sm ${covered ? 'text-[#16A34A]' : 'text-[#2A2035]'}`}>{dp.text}</span>
        {edit && (
          <span className="flex items-center gap-1.5 shrink-0">
            <button className={ebtn} onClick={() => onMove(table, list, dp, -1)}>↑</button>
            <button className={ebtn} onClick={() => onMove(table, list, dp, 1)}>↓</button>
            <button className={ebtn} onClick={() => onRename(table, dp.id, 'text', dp.text)}>edit</button>
            <button className={ebtn} onClick={() => onDelete(table, dp.id, dp.text, !!dp.subs?.length)}>✕</button>
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Syllabus</h1>
            <p className="text-sm text-[#325099]/60 mt-1">The master syllabus dotpoint list. Each point is ticked off automatically once it’s drawn into a booklet — hover a ✓ to see which booklet(s).</p>
          </div>
          <div className="flex items-center gap-2">
            {subjects.length > 0 && (
              <select
                value={sel ? `${sel.subject}|${sel.year}` : ''}
                onChange={(e) => { const [subject, year] = e.target.value.split('|'); setSel({ subject, year: Number(year) }) }}
                className="border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]">
                {subjects.map((s) => <option key={`${s.subject}|${s.year}`} value={`${s.subject}|${s.year}`}>{s.subject} · Year {s.year}</option>)}
              </select>
            )}
            <button onClick={() => setEdit((e) => !e)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${edit ? 'bg-[#325099] text-white border-[#325099]' : 'border-[#DEE7FF] text-[#325099] hover:bg-white'}`}>
              {edit ? 'Done editing' : '✏️ Edit list'}
            </button>
          </div>
        </div>

        {/* Coverage progress */}
        <div className="mt-5 bg-white rounded-2xl border border-[#F0F4FF] p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-[#062E63]">Coverage</p>
            <p className="text-xs text-[#2A2035]/50">{coveredCount}/{leaves.length} dotpoints drawn · {pctCovered}%</p>
          </div>
          <div className="h-2 rounded-full bg-[#EEF2F7] overflow-hidden">
            <div className="h-2 rounded-full bg-[#16A34A] transition-all" style={{ width: `${pctCovered}%` }} />
          </div>
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading syllabus…</p>
        ) : modules.length === 0 ? (
          <div className="mt-6 text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
            <p className="text-sm text-[#2A2035]/50">No syllabus for {sel?.subject} Year {sel?.year} yet.</p>
            {edit && <button onClick={onAddModule} className="mt-3 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold">+ Add the first module</button>}
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {modules.map((mod) => (
              <div key={mod.id} className="bg-white rounded-2xl border border-[#F0F4FF] overflow-hidden">
                <div className="group flex items-center gap-2 px-5 py-3 bg-[#F8FAFF] border-b border-[#F0F4FF]">
                  <h2 className="flex-1 text-sm font-bold text-[#062E63]">{mod.name}</h2>
                  {edit && (
                    <span className="flex items-center gap-1.5">
                      <button className={ebtn} onClick={() => onMove(T_SYLLABUS_MODULES, modules, mod, -1)}>↑</button>
                      <button className={ebtn} onClick={() => onMove(T_SYLLABUS_MODULES, modules, mod, 1)}>↓</button>
                      <button className={ebtn} onClick={() => onRename(T_SYLLABUS_MODULES, mod.id, 'name', mod.name)}>edit</button>
                      <button className={ebtn} onClick={() => onDelete(T_SYLLABUS_MODULES, mod.id, mod.name, true)}>✕</button>
                      <button className="text-[11px] font-semibold text-[#325099] hover:underline ml-1" onClick={() => onAddTopic(mod)}>+ topic</button>
                    </span>
                  )}
                </div>
                <div className="px-5 py-3 space-y-4">
                  {mod.topics.map((tp) => (
                    <div key={tp.id}>
                      <div className="group flex items-center gap-2">
                        <p className="flex-1 text-[13px] font-semibold text-[#325099]">{tp.name}</p>
                        {edit && (
                          <span className="flex items-center gap-1.5">
                            <button className={ebtn} onClick={() => onMove(T_SYLLABUS_TOPICS, mod.topics, tp, -1)}>↑</button>
                            <button className={ebtn} onClick={() => onMove(T_SYLLABUS_TOPICS, mod.topics, tp, 1)}>↓</button>
                            <button className={ebtn} onClick={() => onRename(T_SYLLABUS_TOPICS, tp.id, 'name', tp.name)}>edit</button>
                            <button className={ebtn} onClick={() => onRename(T_SYLLABUS_TOPICS, tp.id, 'inquiry_question', tp.inquiry_question || '')}>iq</button>
                            <button className={ebtn} onClick={() => onDelete(T_SYLLABUS_TOPICS, tp.id, tp.name, true)}>✕</button>
                            <button className="text-[11px] font-semibold text-[#325099] hover:underline ml-1" onClick={() => onAddDotpoint(tp)}>+ dotpoint</button>
                          </span>
                        )}
                      </div>
                      {tp.inquiry_question && <p className="text-[11px] italic text-[#2A2035]/45 mb-1">Inquiry: {tp.inquiry_question}</p>}
                      <div className="pl-1">
                        {tp.dotpoints.map((dp) => (
                          <div key={dp.id}>
                            <DotRow dp={dp} list={tp.dotpoints} table={T_SYLLABUS_DOTPOINTS} />
                            {dp.subs.length > 0 && (
                              <div className="pl-7 border-l border-[#F0F4FF] ml-1.5">
                                {dp.subs.map((s) => <DotRow key={s.id} dp={s} list={dp.subs} table={T_SYLLABUS_DOTPOINTS} />)}
                              </div>
                            )}
                            {edit && (
                              <button className="text-[10px] text-[#325099]/60 hover:underline pl-7 mb-1" onClick={() => onAddSub(tp, dp)}>+ subdotpoint</button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {edit && <button onClick={onAddModule} className="text-xs font-semibold text-[#325099] hover:underline">+ Add module</button>}
          </div>
        )}
      </div>
    </div>
  )
}
