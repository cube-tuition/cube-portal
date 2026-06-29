'use client'
import { authedFetch } from '../../../lib/authedFetch'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import { fetchAllTerms, getCurrentTerm } from '../../../lib/terms'
import TutorNav from '../../../components/TutorNav'
import { buildClassLabelMap } from '../../../lib/classLabels'
import { normalizeDays } from '../../../lib/format'
import { T_ADMINS, T_ATTENDANCE, T_BOOKLETS, T_CLASSES, T_CLASS_BOOKLETS, T_COURSES, T_CURRENT_TUTOR_RATES, T_DROPIN_SESSIONS, T_DROPIN_SIGNINS, T_ENROLMENTS, T_EXAMS, T_FAQ_CATEGORIES, T_FAQ_ITEMS, T_INFO_PAGES, T_INVOICES, T_LESSONS, T_PARENTS, T_PAY_RUNS, T_PAY_RUN_SHIFTS, T_PREPOST_SCORES, T_PREPOST_TESTS, T_QUIZ_RESULTS, T_REFERRALS, T_RESULTS, T_SHIFTS, T_STUDENT_CREDITS, T_STUDENTS, T_SUB_ASSIGNMENTS, T_TERMS, T_TERM_COMMENTS, T_TERM_CRITERIA, T_TIMETABLE, T_TUTORS, T_TUTOR_RATE_MATRIX } from '../../../lib/tables'
import { TABLE_META, dropdownOptions, columnLabel, columnTooltip, isRequired, defaultHiddenCols, validateValue, fieldType, fieldEditorKind, linkedRef, formatDisplay } from '../../../lib/tableMeta'
import { setUndoHandler, announceUndo } from '../../../lib/undo'
import { useReferenceData } from '../../../lib/dbReference'
import LinkedRecordBadge from '../../../components/db/LinkedRecordBadge'
import LevelTestsView from '../../../components/db/LevelTestsView'
import LinkedRecordPicker from '../../../components/db/LinkedRecordPicker'
import RecordDetailPanel from '../../../components/db/RecordDetailPanel'

/*
 * Admin-only: Database Explorer — /tutor/database
 * ─────────────────────────────────────────────────────────────────────────────
 * Airtable-style raw data viewer/editor.
 *   • Sidebar lists every table grouped by domain with live row counts
 *   • Inline cell editing (click → input, Enter/Tab/blur to save)
 *   • Drag column headers left/right to reorder  (order persists per table)
 *   • Drag the right edge of any column header to resize it (widths persist)
 *   • Right-click column header → Rename | Delete Column
 *   • Ctrl/Cmd+Z to undo last schema action
 *   • Add row / delete row (with undo)
 *   • Create table / drop table / rename table
 *   • Row search filter
 */

// ── Table groups ──────────────────────────────────────────────────────────────
const INITIAL_TABLE_GROUPS = [
  // T_PARENTS (guardians) listed directly so orphaned guardian rows (whose
  // student was deleted) are visible — they never appear in the students join.
  { label: 'Core',                 tables: [T_STUDENTS,T_PARENTS,T_TUTORS,T_ADMINS,T_COURSES,T_CLASSES,T_ENROLMENTS,T_TERMS] },
  { label: 'Scheduling',           tables: [T_LESSONS] },
  // Invoices moved to /tutor/accounting/invoices
]

// students keeps its parent/guardian join. tutors and admins are plain tables.
const VIRTUAL = {
  students: {
    realTable: T_STUDENTS, filterCol: null, filterOp: null, filterVal: null,
    showCols: null, excludeCols: [], joinParents: true, defaultRow: {}, noDelete: true,
  },
  enrolments: {
    realTable: T_ENROLMENTS, filterCol: null, filterOp: null, filterVal: null,
    showCols: null, excludeCols: [], joinNames: true, defaultRow: {},
  },
  classes: {
    realTable: T_CLASSES, filterCol: null, filterOp: null, filterVal: null,
    showCols: null, excludeCols: [], joinTermName: true, joinCourseName: true, defaultRow: {},
  },
  lessons: {
    realTable: T_LESSONS, filterCol: null, filterOp: null, filterVal: null,
    showCols: null, excludeCols: [], joinLessonClassName: true, defaultRow: { status: 'scheduled' },
  },
  invoices: {
    realTable: T_INVOICES, filterCol: null, filterOp: null, filterVal: null,
    showCols: null, excludeCols: [], joinTermName: true, joinInvoiceFamily: true, defaultRow: {},
  },
}

const GUARDIAN_COLS    = ['guardian_name','guardian_relationship','guardian_email','guardian_phone']
const PARENT_COL_MAP   = { guardian_name:'full_name', guardian_relationship:'relationship', guardian_email:'email', guardian_phone:'phone' }
const ENROLMENT_NAME_COLS = ['student_name','class_name']
const TERM_NAME_COL      = 'term_name'
const COURSE_NAME_COL    = 'course_name'
const INVOICE_FAMILY_COL      = 'family_name'
const LESSON_CLASS_COL        = 'class_label'          // joined "ClassName (Day)" shown in lessons table
const LESSON_WEEK_COL         = 'week'                  // computed from lesson_date, read-only
const LESSON_MAIN_TEACHER_COL = 'main_teacher'          // rollup from class.teacher, read-only

// Joined/derived columns that are read-only ON A SPECIFIC VIRTUAL VIEW only.
// These same names can be real, editable columns on their own tables (e.g.
// course_name on `courses`, class_name on `classes`), so the read-only rule is
// scoped per table rather than matched by column name globally.
const READONLY_JOIN_COLS = {
  enrolments: ['student_name', 'class_name'],
  classes:    ['term_name', 'course_name'],
  invoices:   ['term_name'],
  lessons:    ['class_label', 'week', 'main_teacher'],
}
const LESSON_SCHED_TEACHER_COL = 'scheduled_teacher'    // resolved name from scheduled_teacher_id, editable dropdown

const DEFAULT_WIDTH  = 150
const PRESET_WIDTHS  = { id:100, year:80, role:90, gender:90, guardian_relationship:140, guardian_name:160, guardian_email:200, guardian_phone:130, email:200, full_name:180, student_name:200, class_name:220, term_name:160, course_name:200, class_label:240, lesson_date:120, week:60, main_teacher:130, scheduled_teacher:160, status:120, price:100, subtotal:110, sibling_discount:140, multi_course_discount:160, total:100, notes:200, family_id:90, student_id:200, family_name:200 }
function defaultWidth(col) { return PRESET_WIDTHS[col] ?? DEFAULT_WIDTH }

// Columns that show a dropdown picker when edited, keyed as "table:col"
// (legacy fallback — lib/tableMeta.js is now the primary source)
const CELL_DROPDOWNS = {
  [`${T_STUDENTS}:year`]:        ['5','6','7','8','9','10','11','12'],
  [`${T_STUDENTS}:status`]:      ['active','trial','disenrol','quit trial'],
  [`${T_ATTENDANCE}:status`]:    ['present','late','absent','makeup'],
  [`${T_ENROLMENTS}:status`]:    ['active','trial','trial complete','disenrol'],
}

// Dropdown options for a table cell: metadata first, legacy map as fallback.
// Virtual table names map to the same real table names used in tableMeta.
function cellDropdown(table, col) {
  return dropdownOptions(table, col) ?? CELL_DROPDOWNS[`${table}:${col}`] ?? null
}

// ── Sort & Filter (Airtable-style) ────────────────────────────────────────────
const FILTER_OPS = [
  ['contains', 'contains'],
  ['not_contains', "doesn't contain"],
  ['is', 'is'],
  ['is_not', 'is not'],
  ['gt', '>'],
  ['gte', '≥'],
  ['lt', '<'],
  ['lte', '≤'],
  ['empty', 'is empty'],
  ['not_empty', 'is not empty'],
]
const NO_VALUE_OPS = new Set(['empty', 'not_empty'])

function applyFilterCondition(cellVal, op, value) {
  const s = cellVal === null || cellVal === undefined ? '' : String(cellVal)
  const q = String(value ?? '').trim()
  switch (op) {
    case 'contains':     return s.toLowerCase().includes(q.toLowerCase())
    case 'not_contains': return !s.toLowerCase().includes(q.toLowerCase())
    case 'is':           return s.toLowerCase() === q.toLowerCase()
    case 'is_not':       return s.toLowerCase() !== q.toLowerCase()
    case 'empty':        return s.trim() === ''
    case 'not_empty':    return s.trim() !== ''
    case 'gt': case 'gte': case 'lt': case 'lte': {
      if (s.trim() === '') return false
      const a = Number(s), b = Number(q)
      const cmp = (!Number.isNaN(a) && !Number.isNaN(b)) ? (a - b) : s.localeCompare(q, undefined, { numeric: true })
      return op === 'gt' ? cmp > 0 : op === 'gte' ? cmp >= 0 : op === 'lt' ? cmp < 0 : cmp <= 0
    }
    default: return true
  }
}

// Compare two NON-empty cell values (numeric-aware, then natural string order).
function cmpCells(a, b) {
  const na = Number(a), nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
// Direction-aware compare; empty values always sort last regardless of direction.
function cmpCellsDir(a, b, dir) {
  const ae = a === null || a === undefined || String(a).trim() === ''
  const be = b === null || b === undefined || String(b).trim() === ''
  if (ae && be) return 0
  if (ae) return 1
  if (be) return -1
  const c = cmpCells(a, b)
  return dir === 'desc' ? -c : c
}

const SF_SEL = 'border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'

// Shared dropdown shell anchored under a toolbar button (closes on outside click / Esc)
function ToolbarPopover({ anchorRef, onClose, width = 380, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !anchorRef?.current?.contains(e.target)) onClose()
    }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose, anchorRef])
  return (
    <div ref={ref} className="absolute top-full mt-1.5 left-0 z-50 bg-white border border-[#DEE7FF] rounded-xl shadow-xl p-3" style={{ width }}>
      {children}
    </div>
  )
}

function SortPanel({ anchorRef, onClose, columns, labelOf, rules, onChange }) {
  const usedCols = new Set(rules.map(r => r.col))
  const firstUnused = columns.find(c => !usedCols.has(c))
  return (
    <ToolbarPopover anchorRef={anchorRef} onClose={onClose} width={360}>
      <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-2">Sort rows</p>
      {rules.length === 0 && <p className="text-[11px] text-[#2A2035]/40 mb-2">No sort applied — rows show in load order.</p>}
      <div className="space-y-1.5">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#2A2035]/40 w-9 shrink-0">{i === 0 ? 'by' : 'then'}</span>
            <select value={rule.col} onChange={e => onChange(rules.map((r, j) => j === i ? { ...r, col: e.target.value } : r))} className={`${SF_SEL} flex-1 min-w-0`}>
              {columns.map(c => <option key={c} value={c} disabled={c !== rule.col && usedCols.has(c)}>{labelOf(c)}</option>)}
            </select>
            <button onClick={() => onChange(rules.map((r, j) => j === i ? { ...r, dir: r.dir === 'asc' ? 'desc' : 'asc' } : r))}
              className="px-2 py-1.5 text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition w-16 shrink-0"
              title="Toggle direction">
              {rule.dir === 'desc' ? '9 → 1' : '1 → 9'}
            </button>
            <button onClick={() => onChange(rules.filter((_, j) => j !== i))} className="w-6 h-6 flex items-center justify-center text-[#2A2035]/30 hover:text-red-500 transition shrink-0" title="Remove">✕</button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <button disabled={!firstUnused} onClick={() => onChange([...rules, { col: firstUnused, dir: 'asc' }])}
          className="text-[11px] font-semibold text-[#325099] hover:underline disabled:opacity-30">+ Add sort</button>
        {rules.length > 0 && <button onClick={() => onChange([])} className="text-[11px] text-[#2A2035]/40 hover:text-red-500">Clear all</button>}
      </div>
    </ToolbarPopover>
  )
}

function FilterPanel({ anchorRef, onClose, columns, labelOf, optionsFor, cfg, onChange }) {
  const setCond = (i, patch) => onChange({ ...cfg, conds: cfg.conds.map((c, j) => j === i ? { ...c, ...patch } : c) })
  return (
    <ToolbarPopover anchorRef={anchorRef} onClose={onClose} width={460}>
      <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-2">Filter rows</p>
      {cfg.conds.length === 0 && <p className="text-[11px] text-[#2A2035]/40 mb-2">No filters — all rows shown.</p>}
      <div className="space-y-1.5">
        {cfg.conds.map((cond, i) => {
          const opts = optionsFor(cond.col)
          const noValue = NO_VALUE_OPS.has(cond.op)
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-14 shrink-0">
                {i === 0
                  ? <span className="text-[10px] text-[#2A2035]/40 pl-1">Where</span>
                  : i === 1
                    ? <select value={cfg.conj} onChange={e => onChange({ ...cfg, conj: e.target.value })} className={`${SF_SEL} w-full`}>
                        <option value="and">and</option><option value="or">or</option>
                      </select>
                    : <span className="text-[10px] text-[#2A2035]/40 pl-1">{cfg.conj}</span>}
              </span>
              <select value={cond.col} onChange={e => setCond(i, { col: e.target.value })} className={`${SF_SEL} w-32 shrink-0`}>
                {columns.map(c => <option key={c} value={c}>{labelOf(c)}</option>)}
              </select>
              <select value={cond.op} onChange={e => setCond(i, { op: e.target.value })} className={`${SF_SEL} w-28 shrink-0`}>
                {FILTER_OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {noValue ? <span className="flex-1" /> : opts && (cond.op === 'is' || cond.op === 'is_not') ? (
                <select value={cond.value ?? ''} onChange={e => setCond(i, { value: e.target.value })} className={`${SF_SEL} flex-1 min-w-0`}>
                  <option value="">—</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type="text" value={cond.value ?? ''} onChange={e => setCond(i, { value: e.target.value })} placeholder="value…" className={`${SF_SEL} flex-1 min-w-0`} />
              )}
              <button onClick={() => onChange({ ...cfg, conds: cfg.conds.filter((_, j) => j !== i) })} className="w-6 h-6 flex items-center justify-center text-[#2A2035]/30 hover:text-red-500 transition shrink-0" title="Remove">✕</button>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-2.5">
        <button onClick={() => onChange({ ...cfg, conds: [...cfg.conds, { col: columns[0], op: 'contains', value: '' }] })}
          className="text-[11px] font-semibold text-[#325099] hover:underline">+ Add condition</button>
        {cfg.conds.length > 0 && <button onClick={() => onChange({ conj: 'and', conds: [] })} className="text-[11px] text-[#2A2035]/40 hover:text-red-500">Clear all</button>}
      </div>
    </ToolbarPopover>
  )
}

// Coloured pill badges for specific table:column values
const CELL_BADGE_COLORS = {
  [`${T_STUDENTS}:status`]: {
    'active':     'bg-emerald-100 text-emerald-800 border border-emerald-200',
    'trial':      'bg-amber-100 text-amber-800 border border-amber-200',
    'disenrol':   'bg-gray-100 text-gray-500 border border-gray-200',
    'quit trial': 'bg-gray-100 text-gray-500 border border-gray-200',
  },
  [`${T_STUDENTS}:is_active`]: {
    'Active':   'bg-emerald-100 text-emerald-800 border border-emerald-200',
    'Inactive': 'bg-rose-100 text-rose-700 border border-rose-200',
  },
  [`${T_ENROLMENTS}:status`]: {
    'active':         'bg-emerald-100 text-emerald-800 border border-emerald-200',
    'trial':          'bg-amber-100 text-amber-800 border border-amber-200',
    'trial complete': 'bg-blue-100 text-blue-800 border border-blue-200',
    'disenrol':       'bg-gray-100 text-gray-500 border border-gray-200',
  },
}

function displayVal(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object')  return JSON.stringify(v)
  return String(v)
}
function getPkCol(cols) { return cols.includes('id') ? 'id' : null }

const COLUMN_TYPES = ['text','integer','bigint','numeric','boolean','uuid','timestamp with time zone','date','jsonb']

// Schema editing has been removed for security (the arbitrary-SQL endpoint is
// gone). Structural changes are done via migrations / the Supabase dashboard.
async function execDDL() {
  throw new Error('Schema editing is disabled. Add columns/tables via the Supabase dashboard or a migration.')
}

// ── Undo action descriptors ───────────────────────────────────────────────────
function undoLabel(action) {
  if (!action) return null
  if (action.type === 'rename_col')   return `Undo rename column "${action.oldName}" → "${action.newName}"`
  if (action.type === 'drop_col')     return `Undo drop column "${action.col}"`
  if (action.type === 'rename_table') return `Undo rename table "${action.oldName}" → "${action.newName}"`
  if (action.type === 'delete_row')   return `Undo delete row`
  if (action.type === 'edit_cell')    return `Undo edit "${action.col}" (was: ${action.oldVal ?? '—'})`
  if (action.type === 'add_row')      return `Undo add row`
  return 'Undo'
}

// ── Create Table Modal ────────────────────────────────────────────────────────
function CreateTableModal({ onClose, onCreated }) {
  const [tableName, setTableName]         = useState('')
  const [withId, setWithId]               = useState(true)
  const [withTimestamps, setWithTimestamps] = useState(false)
  const [cols, setCols]   = useState([{ name:'', type:'text', notNull:false, default:'' }])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const addCol    = () => setCols(p => [...p, { name:'', type:'text', notNull:false, default:'' }])
  const removeCol = (i) => setCols(p => p.filter((_,idx) => idx !== i))
  const updateCol = (i, f, v) => setCols(p => p.map((c,idx) => idx === i ? { ...c, [f]:v } : c))

  const buildSQL = (name) => {
    const defs = []
    if (withId) defs.push('id uuid primary key default gen_random_uuid()')
    for (const c of cols) {
      const cn = c.name.trim(); if (!cn) continue
      let d = `${cn} ${c.type}`
      if (c.notNull)        d += ' not null'
      if (c.default.trim()) d += ` default ${c.default.trim()}`
      defs.push(d)
    }
    if (withTimestamps) {
      defs.push('created_at timestamp with time zone default now()')
      defs.push('updated_at timestamp with time zone default now()')
    }
    return defs.length === 0 ? null : `CREATE TABLE public.${name} (\n  ${defs.join(',\n  ')}\n);`
  }

  const handleCreate = async () => {
    const name = tableName.trim()
    if (!name) { setError('Table name is required'); return }
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) { setError('Lowercase letters, numbers, underscores only'); return }
    const sql = buildSQL(name)
    if (!sql) { setError('Add at least one column'); return }
    setSaving(true); setError(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      await execDDL(session.access_token, sql)
      onCreated(name)
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const previewSQL = buildSQL(tableName.trim() || 'table_name') ?? `CREATE TABLE public.${tableName.trim() || 'table_name'} ( /* add columns */ );`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF]">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-[#325099]">Database</p>
            <h2 className="text-base font-bold text-[#2A2035] font-display">Create New Table</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:text-[#2A2035] hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5 flex-1">
          <div>
            <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-1.5">Table Name</label>
            <input type="text" value={tableName} onChange={e => setTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_'))} placeholder="e.g. lesson_notes" className="w-full px-3 py-2 rounded-lg border border-[#DEE7FF] text-sm text-[#2A2035] placeholder-[#2A2035]/30 focus:outline-none focus:border-[#325099] font-mono" />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={withId} onChange={e => setWithId(e.target.checked)} className="w-3.5 h-3.5 accent-[#325099]" />
              <span className="text-xs font-medium text-[#2A2035]">Auto UUID <code className="text-[10px] bg-[#F0F4FF] px-1 py-0.5 rounded text-[#325099]">id</code></span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={withTimestamps} onChange={e => setWithTimestamps(e.target.checked)} className="w-3.5 h-3.5 accent-[#325099]" />
              <span className="text-xs font-medium text-[#2A2035]"><code className="text-[10px] bg-[#F0F4FF] px-1 py-0.5 rounded text-[#325099]">created_at</code> / <code className="text-[10px] bg-[#F0F4FF] px-1 py-0.5 rounded text-[#325099]">updated_at</code></span>
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099]">Columns</label>
              <button onClick={addCol} className="text-[10px] font-bold text-[#325099] hover:text-[#062E63] px-2 py-1 rounded-md hover:bg-[#F0F4FF] transition">+ Add column</button>
            </div>
            <div className="grid gap-x-2 mb-1 px-1" style={{ gridTemplateColumns:'1fr 1fr 60px 80px 24px' }}>
              {['Name','Type','Not Null','Default',''].map(h => <span key={h} className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#2A2035]/40">{h}</span>)}
            </div>
            <div className="flex flex-col gap-1.5">
              {cols.map((col, i) => (
                <div key={i} className="grid gap-x-2 items-center" style={{ gridTemplateColumns:'1fr 1fr 60px 80px 24px' }}>
                  <input type="text" value={col.name} onChange={e => updateCol(i,'name',e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_'))} placeholder="column_name" className="px-2 py-1.5 rounded-lg border border-[#DEE7FF] text-xs font-mono text-[#2A2035] placeholder-[#2A2035]/25 focus:outline-none focus:border-[#325099]" />
                  <select value={col.type} onChange={e => updateCol(i,'type',e.target.value)} className="px-2 py-1.5 rounded-lg border border-[#DEE7FF] text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white">
                    {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="flex justify-center"><input type="checkbox" checked={col.notNull} onChange={e => updateCol(i,'notNull',e.target.checked)} className="w-3.5 h-3.5 accent-[#325099]" /></div>
                  <input type="text" value={col.default} onChange={e => updateCol(i,'default',e.target.value)} placeholder="now()" className="px-2 py-1.5 rounded-lg border border-[#DEE7FF] text-xs font-mono text-[#2A2035] placeholder-[#2A2035]/25 focus:outline-none focus:border-[#325099]" />
                  <button onClick={() => removeCol(i)} className="flex items-center justify-center w-6 h-6 rounded-full text-[#2A2035]/25 hover:text-red-500 hover:bg-red-50 transition text-sm">×</button>
                </div>
              ))}
            </div>
          </div>
          {tableName.trim() && (
            <div>
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#2A2035]/40 mb-1">SQL Preview</p>
              <pre className="text-[10px] font-mono text-[#325099] bg-[#F0F4FF] rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all">{previewSQL}</pre>
            </div>
          )}
          {error && <p className="text-xs font-semibold text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#DEE7FF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !tableName.trim()} className="px-5 py-2 bg-[#325099] text-white text-sm font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">{saving ? 'Creating…' : 'Create Table'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Column Context Menu ───────────────────────────────────────────────────────
function ColContextMenu({ x, y, col, isPk, onHide, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const keyHandler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [onClose])

  // Clamp to viewport
  const style = { position:'fixed', left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 120), zIndex: 9999 }

  return (
    <div ref={ref} style={style} className="bg-white border border-[#DEE7FF] rounded-xl shadow-xl py-1.5 min-w-[170px]">
      <p className="px-3 py-1 text-[9px] font-bold tracking-[0.2em] uppercase text-[#325099]/40 select-none truncate">{col}</p>
      <div className="border-t border-[#DEE7FF] my-1" />
      <button
        onClick={onHide}
        disabled={isPk}
        className="w-full text-left px-3 py-2 text-sm text-[#2A2035] hover:bg-[#F0F4FF] transition flex items-center gap-2.5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span className="text-base leading-none">🙈</span>
        <span className="font-medium">Hide column</span>
      </button>
    </div>
  )
}

// ── Enrolment Popover ─────────────────────────────────────────────────────────
function EnrolPopover({ classId, x, y, enrolled = [], allStudents, onEnrol, onClose, saving }) {
  const ref = useRef(null)
  const inputRef = useRef(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [])

  const enrolledIds = new Set(enrolled.map(s => s.id))
  const available = allStudents
    .filter(s => !enrolledIds.has(s.id))
    .filter(s => !search.trim() || s.full_name.toLowerCase().includes(search.trim().toLowerCase()))

  const style = { position: 'fixed', left: Math.min(x, window.innerWidth - 224), top: Math.min(y, window.innerHeight - 320), zIndex: 9999 }

  return (
    <div ref={ref} style={style} className="bg-white border border-[#DEE7FF] rounded-xl shadow-xl w-56 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#DEE7FF] bg-[#F8FAFF]">
        <span className="text-[10px] font-bold text-[#325099] uppercase tracking-wider">Enrol Student</span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-full text-[#2A2035]/30 hover:text-[#2A2035] hover:bg-[#F0F4FF] transition text-sm">×</button>
      </div>
      <div className="px-2 py-1.5 border-b border-[#DEE7FF]">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search students…"
          className="w-full text-xs px-2 py-1 rounded-lg border border-[#DEE7FF] focus:outline-none focus:border-[#325099] text-[#2A2035] placeholder-[#2A2035]/30"
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {available.length === 0 ? (
          <p className="text-[10px] text-[#2A2035]/40 px-3 py-4 text-center">
            {search.trim() ? 'No matches' : enrolledIds.size >= allStudents.length ? 'All students enrolled' : 'No students available'}
          </p>
        ) : available.map(s => (
          <button
            key={s.id}
            onClick={() => onEnrol(classId, s.id)}
            disabled={saving}
            className="w-full text-left px-3 py-2 text-xs text-[#2A2035] hover:bg-[#F0F4FF] transition disabled:opacity-40 flex items-center gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#325099]/30 shrink-0" />
            {s.full_name}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Student Directory helpers ─────────────────────────────────────────────────
function shortId(uuid = '') { return uuid.slice(-8).toUpperCase() }
function yearBadgeColor(yr) {
  const n = parseInt(yr, 10)
  if (n <= 6) return 'bg-[#D1FAE5] text-[#065F46]'
  if (n <= 10) return 'bg-[#DEE7FF] text-[#062E63]'
  return 'bg-[#FEF3C7] text-[#92400E]'
}

function SDBadge({ text, cls }) {
  return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{text}</span>
}

function SDDetailRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/60 font-semibold mb-0.5">{label}</p>
        <p className="text-sm text-[#2A2035] break-words">{value || '—'}</p>
      </div>
    </div>
  )
}

const SD_INPUT_CLS = 'w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] text-[#2A2035] placeholder-[#2A2035]/35 focus:outline-none focus:border-[#BACBFF] focus:ring-1 focus:ring-[#BACBFF] transition'
const SD_BLANK = { studentName:'', gender:'', year:'', studentEmail:'', studentPhone:'', school:'', guardianName:'', relationship:'', parentEmail:'', parentPhone:'' }

function SDField({ label, required, children }) {
  return (
    <div>
      <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function AddStudentModal({ onClose, onAdded }) {
  const [form, setForm]     = useState(SD_BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.studentName.trim()) { setError('Student full name is required.'); return }
    // Soft validation — warn but allow saving (data can be fixed later)
    const warnings = []
    for (const [field, val] of [['Student email', form.studentEmail], ['Parent email', form.parentEmail]]) {
      const w = val.trim() && validateValue(T_STUDENTS, 'email', val.trim())
      if (w) warnings.push(`${field}: ${w}`)
    }
    for (const [field, val] of [['Student phone', form.studentPhone], ['Parent phone', form.parentPhone]]) {
      const w = val.trim() && validateValue(T_STUDENTS, 'phone', val.trim())
      if (w) warnings.push(`${field}: ${w}`)
    }
    if (warnings.length && !window.confirm(`⚠ ${warnings.join('\n')}\n\nSave anyway?`)) return
    setSaving(true); setError(null)
    try {
      const { data: newStudent, error: sErr } = await supabase
        .from(T_STUDENTS)
        .insert({ full_name: form.studentName.trim(), gender: form.gender || null, year: form.year || null, email: form.studentEmail.trim() || null, phone: form.studentPhone.trim() || null, school: form.school.trim() || null })
        .select('id, full_name, email, school, year, gender, phone').single()
      if (sErr) throw new Error(sErr.message)
      const hasGuardian = form.guardianName.trim() || form.parentEmail.trim() || form.parentPhone.trim()
      if (hasGuardian) {
        const { error: pErr } = await supabase.from(T_PARENTS).insert({ student_id: newStudent.id, full_name: form.guardianName.trim() || null, relationship: form.relationship.trim() || null, email: form.parentEmail.trim() || null, phone: form.parentPhone.trim() || null })
        if (pErr) throw new Error(pErr.message)
      }
      onAdded(newStudent); onClose()
    } catch (err) { setError(err.message || 'Something went wrong.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-[#DEE7FF] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#DEE7FF] flex items-center justify-center text-lg">🎓</div>
            <div>
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Admin · Directory</p>
              <p className="text-sm font-bold text-[#2A2035] font-display leading-tight">Add New Student</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[#2A2035]/40 hover:text-[#2A2035] hover:bg-[#DEE7FF] transition text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#325099] text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</div>
                <p className="text-xs font-bold tracking-[0.15em] uppercase text-[#325099]">Student Details</p>
              </div>
              <div className="space-y-3.5">
                <SDField label="Full Name" required>
                  <input type="text" placeholder="e.g. Sarah Johnson" value={form.studentName} onChange={set('studentName')} className={SD_INPUT_CLS} autoFocus />
                </SDField>
                <div className="grid grid-cols-2 gap-3">
                  <SDField label="Gender">
                    {/* values match existing student records (M / F / Other / Unknown) */}
                    <select value={form.gender} onChange={set('gender')} className={SD_INPUT_CLS}>
                      <option value="">Select gender…</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                      <option value="Other">Other</option>
                      <option value="Unknown">Prefer not to say</option>
                    </select>
                  </SDField>
                  <SDField label="Year">
                    <select value={form.year} onChange={set('year')} className={SD_INPUT_CLS}>
                      <option value="">Select year…</option>
                      {['K','1','2','3','4','5','6','7','8','9','10','11','12'].map(y => <option key={y} value={y}>{y === 'K' ? 'Kindergarten' : `Year ${y}`}</option>)}
                    </select>
                  </SDField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SDField label="Student Email"><input type="email" placeholder="student@example.com" value={form.studentEmail} onChange={set('studentEmail')} className={SD_INPUT_CLS} /></SDField>
                  <SDField label="Student Phone"><input type="tel" placeholder="04XX XXX XXX" value={form.studentPhone} onChange={set('studentPhone')} className={SD_INPUT_CLS} /></SDField>
                </div>
                <SDField label="School"><input type="text" placeholder="e.g. Chatswood High School" value={form.school} onChange={set('school')} className={SD_INPUT_CLS} /></SDField>
              </div>
            </div>
            <div className="border-t border-[#DEE7FF]" />
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#92400E] text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</div>
                <p className="text-xs font-bold tracking-[0.15em] uppercase text-[#92400E]">Guardian Details</p>
                <span className="text-[10px] text-[#2A2035]/40 font-medium">(optional)</span>
              </div>
              <div className="space-y-3.5">
                <SDField label="Guardian Full Name"><input type="text" placeholder="e.g. Michael Johnson" value={form.guardianName} onChange={set('guardianName')} className={SD_INPUT_CLS} /></SDField>
                <SDField label="Relationship to Student">
                  <select value={form.relationship} onChange={set('relationship')} className={SD_INPUT_CLS}>
                    <option value="">Select relationship…</option>
                    <option>Mother</option><option>Father</option><option>Guardian</option><option>Grandparent</option><option>Other</option>
                  </select>
                </SDField>
                <div className="grid grid-cols-2 gap-3">
                  <SDField label="Parent Email"><input type="email" placeholder="parent@example.com" value={form.parentEmail} onChange={set('parentEmail')} className={SD_INPUT_CLS} /></SDField>
                  <SDField label="Parent Phone"><input type="tel" placeholder="04XX XXX XXX" value={form.parentPhone} onChange={set('parentPhone')} className={SD_INPUT_CLS} /></SDField>
                </div>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] shrink-0 flex items-center justify-between gap-3">
            {error
              ? <p className="text-xs text-rose-500 font-medium flex-1">{error}</p>
              : <p className="text-[10px] text-[#2A2035]/40 flex-1">Fields marked <span className="text-rose-400">*</span> are required</p>
            }
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-xl hover:bg-[#DEE7FF] transition">Cancel</button>
              <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-semibold bg-[#325099] text-white rounded-xl hover:bg-[#062E63] transition disabled:opacity-50 flex items-center gap-2">
                {saving ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : 'Add Student'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Sibling Popover ───────────────────────────────────────────────────────────
function SiblingPopover({ studentId, x, y, allStudents, currentSiblings, onAdd, onClose, saving }) {
  const ref      = useRef(null)
  const inputRef = useRef(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [])

  const siblingIds = new Set(currentSiblings.map(s => s.id))
  siblingIds.add(studentId) // exclude self
  const available = allStudents
    .filter(s => !siblingIds.has(s.id))
    .filter(s => !search.trim() || s.full_name.toLowerCase().includes(search.trim().toLowerCase()))

  const style = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 224),
    top:  Math.min(y, window.innerHeight - 320),
    zIndex: 9999,
  }

  return (
    <div ref={ref} style={style} className="bg-white border border-[#FDE68A] rounded-xl shadow-xl w-56 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#FDE68A] bg-[#FFFBEB]">
        <span className="text-[10px] font-bold text-[#92400E] uppercase tracking-wider">Add Sibling</span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-full text-[#92400E]/40 hover:text-[#92400E] hover:bg-[#FEF3C7] transition text-sm">×</button>
      </div>
      <div className="px-2 py-1.5 border-b border-[#FDE68A]">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search students…"
          className="w-full text-xs px-2 py-1 rounded-lg border border-[#FDE68A] focus:outline-none focus:border-[#92400E] text-[#2A2035] placeholder-[#2A2035]/30"
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {available.length === 0 ? (
          <p className="text-[10px] text-[#2A2035]/40 px-3 py-4 text-center">
            {search.trim() ? 'No matches' : 'No other students available'}
          </p>
        ) : available.map(s => (
          <button
            key={s.id}
            onClick={() => onAdd(studentId, s.id)}
            disabled={saving}
            className="w-full text-left px-3 py-2 text-xs text-[#2A2035] hover:bg-[#FFFBEB] transition disabled:opacity-40 flex items-center gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#92400E]/30 shrink-0" />
            {s.full_name}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Drop-in Session Modal (create + edit) ─────────────────────────────────────
/* ── Families view (guardians table) ──────────────────────────────────────────
 * Display-layer grouping only — guardian rows in the DB stay one-per-student.
 * Groups by students.family_id; students without a family number appear as
 * single-student "families" flagged as not linked.
 */
const FAM_INV_STATUS_CLS = {
  draft:    'bg-gray-100 text-gray-600 border border-gray-200',
  approved: 'bg-blue-100 text-blue-800 border border-blue-200',
  voided:   'bg-gray-100 text-gray-400 border border-gray-200 line-through',
}
const FAM_PAY_STATUS_CLS = {
  paid:    'bg-emerald-100 text-emerald-800 border border-emerald-200',
  partial: 'bg-amber-100 text-amber-800 border border-amber-200',
  unpaid:  'bg-rose-100 text-rose-700 border border-rose-200',
  overdue: 'bg-rose-100 text-rose-700 border border-rose-300 font-bold',
}
const famNorm = s => (s ?? '').trim().toLowerCase()

function FamiliesView() {
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState(null)
  const [families, setFamilies] = useState([])
  const [termById, setTermById] = useState({})
  const [currentTermId, setCurrentTermId] = useState(null)
  const [search, setSearch]     = useState('')
  const [selectedKey, setSelectedKey] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [stuRes, gRes, invRes, allTerms] = await Promise.all([
          supabase.from(T_STUDENTS).select('id, full_name, year, status, family_id').order('full_name'),
          supabase.from(T_PARENTS).select('id, full_name, relationship, email, phone, student_id'),
          supabase.from(T_INVOICES).select('id, term_id, family_id, student_id, invoice_number, status, payment_status, delivery_status, total, due_date').order('created_at', { ascending: false }),
          fetchAllTerms(),
        ])
        for (const r of [stuRes, gRes, invRes]) if (r.error) throw new Error(r.error.message)
        const students = stuRes.data ?? [], guardians = gRes.data ?? [], invoices = invRes.data ?? []
        setTermById(Object.fromEntries((allTerms ?? []).map(t => [t.id, t])))
        setCurrentTermId(getCurrentTerm(allTerms ?? [])?.id ?? null)

        const guardiansByStudent = {}
        for (const g of guardians) (guardiansByStudent[String(g.student_id)] = guardiansByStudent[String(g.student_id)] ?? []).push(g)

        const buildFamily = (key, familyId, members) => {
          // Dedupe guardians across siblings by name+email; head = guardian linked to most members
          const seen = {}
          for (const s of members) for (const g of (guardiansByStudent[s.id] ?? [])) {
            const gk = `${famNorm(g.full_name)}|${famNorm(g.email)}`
            if (!seen[gk]) seen[gk] = { ...g, linkCount: 0 }
            seen[gk].linkCount++
          }
          const gs = Object.values(seen).sort((a, b) => b.linkCount - a.linkCount || a.id - b.id)
          const memberIds = new Set(members.map(s => s.id))
          const famInvoices = invoices.filter(inv =>
            (familyId !== null && inv.family_id === familyId) || (inv.family_id === null && memberIds.has(inv.student_id)))
          return { key, familyId, students: members, head: gs[0] ?? null, otherGuardians: gs.slice(1), invoices: famInvoices }
        }

        const byFam = {}
        const unlinked = []
        for (const s of students) {
          if (s.family_id === null || s.family_id === undefined) unlinked.push(s)
          else (byFam[s.family_id] = byFam[s.family_id] ?? []).push(s)
        }
        const result = [
          ...Object.entries(byFam).map(([fid, members]) => buildFamily(`f_${fid}`, Number(fid), members)),
          ...unlinked.map(s => buildFamily(`s_${s.id}`, null, [s])),
        ]
        result.sort((a, b) => (a.familyId === null) - (b.familyId === null)
          || (a.head?.full_name ?? a.students[0]?.full_name ?? '').localeCompare(b.head?.full_name ?? b.students[0]?.full_name ?? ''))
        setFamilies(result)
      } catch (e) { setErr(e.message || 'Failed to load families.') }
      finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-full"><p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p></div>
  if (err)     return <div className="flex items-center justify-center h-full"><p className="text-xs text-rose-600">{err}</p></div>

  const q = search.trim().toLowerCase()
  const filtered = q ? families.filter(f =>
    (f.head?.full_name ?? '').toLowerCase().includes(q) ||
    f.students.some(s => (s.full_name ?? '').toLowerCase().includes(q)) ||
    (f.head?.email ?? '').toLowerCase().includes(q)
  ) : families
  const sel = filtered.find(f => f.key === selectedKey) ?? null
  const currentInvoices = sel ? sel.invoices.filter(i => i.term_id === currentTermId && i.status !== 'voided') : []
  const pastInvoices    = sel ? sel.invoices.filter(i => i.term_id !== currentTermId) : []
  const fmtMoney = v => v === null || v === undefined ? '—' : `$${Number(v).toFixed(2)}`

  const InvoiceRow = ({ inv, highlight }) => (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] ${highlight ? 'border-[#BACBFF] bg-[#F0F4FF]' : 'border-[#E8EDF8] bg-white'}`}>
      <span className="font-mono text-[#325099]/70 shrink-0">{inv.invoice_number ?? `#${inv.id}`}</span>
      <span className="text-[#2A2035]/50 truncate flex-1">{termById[inv.term_id]?.name ?? ''}</span>
      <span className="font-semibold text-[#2A2035] tabular-nums">{fmtMoney(inv.total)}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${FAM_INV_STATUS_CLS[inv.status] ?? 'bg-gray-100 text-gray-500'}`}>{inv.status}</span>
      {inv.payment_status && <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${FAM_PAY_STATUS_CLS[inv.payment_status] ?? 'bg-gray-100 text-gray-500'}`}>{inv.payment_status}</span>}
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#325099]/50 text-sm">🔍</span>
          <input type="text" placeholder="Search by guardian or student name…" value={search} onChange={e => { setSearch(e.target.value); setSelectedKey(null) }} className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#DEE7FF] bg-white text-[#2A2035] placeholder-[#2A2035]/40 focus:outline-none focus:border-[#BACBFF] transition" />
        </div>
        <span className="text-[10px] text-[#325099]/50 font-semibold shrink-0">{filtered.length} {q ? 'found' : 'families'}</span>
      </div>
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x divide-[#DEE7FF]">
        {/* Family list */}
        <div className="overflow-y-auto p-4 space-y-2">
          {filtered.map(f => (
            <button key={f.key} onClick={() => setSelectedKey(f.key)} className={`w-full text-left bg-white rounded-xl border px-4 py-3 transition shadow-sm hover:shadow-md ${selectedKey === f.key ? 'border-[#325099] ring-1 ring-[#BACBFF]' : 'border-[#E8EDF8]'}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#2A2035] truncate">{f.head?.full_name ?? <span className="italic text-[#2A2035]/40">No guardian recorded</span>}</span>
                {f.familyId !== null
                  ? <span className="text-[9px] font-semibold bg-[#DEE7FF] text-[#062E63] px-1.5 py-0.5 rounded-full shrink-0">Family #{f.familyId}</span>
                  : <span className="text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0" title="Student has no family number — link siblings via the Students table">not linked</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {f.students.map(s => (
                  <span key={s.id} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                    {s.full_name}{s.year ? ` · Yr ${s.year}` : ''}
                  </span>
                ))}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-[#2A2035]/40 text-center py-10">No families match &ldquo;{search}&rdquo;</p>}
        </div>
        {/* Detail panel */}
        <div className="overflow-y-auto p-5 bg-[#FBFCFF]">
          {!sel ? (
            <div className="flex items-center justify-center h-full text-xs text-[#2A2035]/35">Select a family to see details</div>
          ) : (
            <div className="space-y-5">
              {/* Head guardian */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">Guardian{sel.otherGuardians.length ? 's' : ''}</p>
                {sel.head ? (
                  <div className="bg-white rounded-xl border border-[#E8EDF8] px-4 py-3">
                    <p className="text-sm font-bold text-[#2A2035]">{sel.head.full_name} {sel.head.relationship && <span className="text-[10px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-1.5 py-0.5 rounded-full ml-1">{sel.head.relationship}</span>}</p>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[11px]">
                      {sel.head.email && <a href={`mailto:${sel.head.email}`} className="text-[#325099] hover:underline">✉ {sel.head.email}</a>}
                      {sel.head.phone && <a href={`tel:${sel.head.phone}`} className="text-[#325099] hover:underline">☎ {sel.head.phone}</a>}
                      {!sel.head.email && !sel.head.phone && <span className="text-[#2A2035]/35 italic">no contact details</span>}
                    </div>
                  </div>
                ) : <p className="text-xs text-[#2A2035]/40 italic">No guardian recorded for this family.</p>}
                {sel.otherGuardians.map(g => (
                  <div key={g.id} className="mt-1.5 bg-white rounded-xl border border-[#E8EDF8] px-4 py-2.5 text-xs text-[#2A2035]">
                    <span className="font-semibold">{g.full_name}</span>
                    {g.relationship && <span className="text-[#2A2035]/50"> · {g.relationship}</span>}
                    {g.email && <a href={`mailto:${g.email}`} className="text-[#325099] hover:underline ml-2">✉ {g.email}</a>}
                  </div>
                ))}
              </section>
              {/* Students */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">Students</p>
                <div className="space-y-1.5">
                  {sel.students.map(s => (
                    <div key={s.id} className="flex items-center gap-2 bg-white rounded-xl border border-[#E8EDF8] px-4 py-2.5">
                      <span className="text-xs font-bold text-[#2A2035] flex-1 truncate">{s.full_name}</span>
                      {s.year && <span className="text-[9px] font-semibold bg-[#DEE7FF] text-[#062E63] px-1.5 py-0.5 rounded-full">Yr {s.year}</span>}
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${s.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              </section>
              {/* Last conversation — placeholder */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">Last Conversation</p>
                <div className="bg-white rounded-xl border border-dashed border-[#DEE7FF] px-4 py-3 text-[11px] text-[#2A2035]/40 italic">
                  Coming soon — communication tracking hasn&rsquo;t been wired up yet. This panel will show the most recent email/call with this family.
                </div>
              </section>
              {/* Invoices */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">Invoices — Current Term</p>
                {currentInvoices.length
                  ? <div className="space-y-1.5">{currentInvoices.map(inv => <InvoiceRow key={inv.id} inv={inv} highlight />)}</div>
                  : <p className="text-[11px] text-[#2A2035]/40 italic">No invoice for the current term.</p>}
                {pastInvoices.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-[10px] font-semibold text-[#325099]/60 cursor-pointer select-none hover:text-[#325099]">History ({pastInvoices.length})</summary>
                    <div className="space-y-1.5 mt-2">{pastInvoices.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}</div>
                  </details>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const DROPIN_SUBJECTS_LIST = ['Maths', 'English', 'Chemistry', 'Biology', 'Physics', 'Economics']

function SessionModal({ session, onClose, onSaved }) {
  const isEdit = !!session
  const blank = {
    session_date: '', start_time: '', end_time: '',
    location: 'Chatswood centre', subjects: [], tutors: [],
    max_capacity: 5, notes: '',
  }
  const [form, setForm] = useState(isEdit ? {
    session_date: session.session_date ?? '',
    start_time: session.start_time?.slice(0,5) ?? '',
    end_time: session.end_time?.slice(0,5) ?? '',
    location: session.location ?? 'Chatswood centre',
    subjects: session.subjects ?? [],
    tutors: session.tutors ?? [],
    max_capacity: session.max_capacity ?? 5,
    notes: session.notes ?? '',
  } : blank)
  const [tutorsList, setTutorsList] = useState([])   // [{id, full_name}] from DB
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('tutors').select('id, full_name').eq('active', true).order('full_name').then(({ data }) => setTutorsList(data || []))
  }, [])

  const toggleSubject = s => setForm(f => ({
    ...f, subjects: f.subjects.includes(s) ? f.subjects.filter(x => x !== s) : [...f.subjects, s]
  }))
  const toggleTutor = name => setForm(f => ({
    ...f, tutors: f.tutors.includes(name) ? f.tutors.filter(x => x !== name) : [...f.tutors, name]
  }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.session_date || !form.start_time || !form.end_time) { setErr('Date and times are required.'); return }
    setSaving(true); setErr('')
    const payload = {
      session_date: form.session_date,
      start_time: form.start_time,
      end_time: form.end_time,
      location: form.location || null,
      subjects: form.subjects,
      tutors: form.tutors,
      max_capacity: Number(form.max_capacity) || 5,
      notes: form.notes || null,
    }
    if (isEdit) {
      const { error } = await supabase.from('dropin_sessions').update(payload).eq('id', session.id)
      if (error) { setErr(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('dropin_sessions').insert(payload)
      if (error) { setErr(error.message); setSaving(false); return }
    }
    onSaved()
  }

  const INP = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <h2 className="text-sm font-bold text-[#062E63]">{isEdit ? 'Edit Session' : 'New Drop-in Session'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
          {/* Date + times */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Date</label>
              <input type="date" value={form.session_date} onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))} required className={INP} />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Start</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} required className={INP} />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">End</label>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} required className={INP} />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Capacity</label>
              <input type="number" min={1} max={50} value={form.max_capacity} onChange={e => setForm(f => ({ ...f, max_capacity: e.target.value }))} className={INP} />
            </div>
          </div>
          {/* Location */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Location</label>
            <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Chatswood centre" className={INP} />
          </div>
          {/* Subjects */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Subjects available</label>
            <div className="flex flex-wrap gap-2">
              {DROPIN_SUBJECTS_LIST.map(s => (
                <button key={s} type="button" onClick={() => toggleSubject(s)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${form.subjects.includes(s) ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          {/* Tutors */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-2">Tutors</label>
            {tutorsList.length === 0 ? (
              <p className="text-[10px] text-[#2A2035]/40 italic">Loading tutors…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tutorsList.map(t => (
                  <button key={t.id} type="button" onClick={() => toggleTutor(t.full_name)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${form.tutors.includes(t.full_name) ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}>
                    {t.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Notes */}
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes…" className={INP + ' resize-none'} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </form>
        <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Session'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Signin Modal ───────────────────────────────────────────────────────────
function AddSigninModal({ sessionId, existingSignins, allStudents, onClose, onAdded }) {
  const SUBJECTS = ['Maths', 'English', 'Chemistry', 'Biology', 'Physics', 'Economics']
  const [studentId, setStudentId]   = useState('')
  const [subject, setSubject]       = useState('')
  const [question, setQuestion]     = useState('')
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState('')

  const bookedIds = new Set(existingSignins.map(s => s.student_id))
  const available = allStudents.filter(s => !bookedIds.has(s.id))

  const handleSubmit = async () => {
    if (!studentId || !subject) { setErr('Select a student and subject.'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('dropin_signins').insert({
      session_id: sessionId,
      student_id: studentId,
      subject,
      question: question.trim() || null,
      status: 'booked',
    })
    if (error) { setErr(error.message); setSaving(false); return }
    onAdded()
  }

  const INP = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F4FF]">
          <h2 className="text-sm font-bold text-[#062E63]">Add Student to Session</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] transition text-lg">×</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} className={INP}>
              <option value="">Select student…</option>
              {available.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Subject</label>
            <select value={subject} onChange={e => setSubject(e.target.value)} className={INP}>
              <option value="">Select subject…</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-[#325099] mb-1">Question / topic <span className="font-normal text-[#2A2035]/40">(optional)</span></label>
            <input type="text" value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g. Quadratic equations" className={INP} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#F0F4FF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-xs font-semibold bg-[#325099] text-white rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Adding…' : 'Add Student'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Cancel Lesson Modal ───────────────────────────────────────────────────────
function CancelLessonModal({ row, onClose, onCancelled }) {
  const [students,     setStudents]     = useState([])
  const [studentId,    setStudentId]    = useState('')
  const [type,         setType]         = useState('credit')
  const [reason,       setReason]       = useState('')
  const [preview,      setPreview]      = useState(null) // { credit_amount, enrolment_price }
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState(null)

  // Load enrolled students for this class
  useEffect(() => {
    if (!row?.class_id) return
    supabase
      .from('enrolments')
      .select('student_id, price, students(id, full_name)')
      .eq('class_id', row.class_id)
      .in('status', ['active', 'trial'])
      .then(({ data }) => {
        const list = (data || []).map(e => ({ id: e.students?.id, full_name: e.students?.full_name, price: e.price })).filter(s => s.id)
        setStudents(list)
        // Auto-select if 1-on-1
        if (list.length === 1) {
          setStudentId(list[0].id)
          setPreview({ credit_amount: Math.round((Number(list[0].price) / 10) * 100) / 100, enrolment_price: list[0].price })
        }
      })
  }, [row?.class_id])

  const handleStudentChange = (id) => {
    setStudentId(id)
    const s = students.find(s => s.id === id)
    if (s?.price) setPreview({ credit_amount: Math.round((Number(s.price) / 10) * 100) / 100, enrolment_price: s.price })
    else setPreview(null)
  }

  const handleSubmit = async () => {
    if (!studentId) { setError('Please select a student.'); return }
    setSubmitting(true); setError(null)
    try {
      const res = await authedFetch('/api/cancel-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson_id: row.id, student_id: studentId, type, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      onCancelled(row.id, studentId, json)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const studentName = students.find(s => s.id === studentId)?.full_name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#DEE7FF]">
          <div>
            <h3 className="font-bold text-[#062E63] text-sm">Cancel Lesson</h3>
            <p className="text-[11px] text-[#325099]/50 mt-0.5">
              {row.class_label || `Class ${row.class_id}`} · {row.lesson_date}
            </p>
          </div>
          <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099] text-lg">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Student */}
          <div>
            <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Student</label>
            <select
              value={studentId}
              onChange={e => handleStudentChange(e.target.value)}
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
            >
              <option value="">— select student —</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>

          {/* Type */}
          <div>
            <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-2">Cancellation type</label>
            <div className="flex gap-2">
              {[
                { id: 'credit',     label: 'Credit',     desc: 'Student notified us beforehand' },
                { id: 'non_credit', label: 'Non-credit',  desc: 'No-show without notice' },
              ].map(t => (
                <button key={t.id} onClick={() => setType(t.id)}
                  className={`flex-1 text-left px-3 py-2.5 rounded-xl border transition text-xs ${type === t.id ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] hover:border-[#325099]/40'}`}>
                  <p className={`font-semibold ${type === t.id ? 'text-[#062E63]' : 'text-[#325099]/70'}`}>{t.label}</p>
                  <p className="text-[10px] text-[#325099]/40 mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Credit preview */}
          {type === 'credit' && preview && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs">
              <p className="font-semibold text-emerald-800">
                Credit: ${preview.credit_amount.toFixed(2)}
                <span className="font-normal text-emerald-600 ml-1">(${preview.enrolment_price} ÷ 10 weeks)</span>
              </p>
              <p className="text-emerald-600 mt-0.5">Will be applied to the current or next invoice depending on delivery status.</p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Reason <span className="font-normal normal-case">(optional)</span></label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Sick, family holiday…"
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:border-[#325099]"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-[#325099]/60 border border-[#DEE7FF] px-4 py-2 rounded-full hover:border-[#325099] transition">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting || !studentId}
            className="text-xs font-semibold bg-red-600 text-white px-5 py-2 rounded-full hover:bg-red-700 transition disabled:opacity-40">
            {submitting ? 'Cancelling…' : `Cancel${studentName ? ` ${studentName.split(' ')[0]}'s` : ''} lesson`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DatabasePage() {
  const router = useRouter()

  const [staff, setStaff]           = useState(null)
  const [allTerms, setAllTerms]               = useState([])
  const [currentTermId, setCurrentTermId]     = useState(null)
  const [currentTermName, setCurrentTermName] = useState('')
  // Invoices
  const [invoiceTermId, setInvoiceTermId]       = useState(null)
  const [creditModal, setCreditModal]           = useState(null)  // { invoiceId, members } | null
  const [topUpModal,  setTopUpModal]            = useState(null)  // invoice card object | null  (new invoice modal)
  const [referralModal, setReferralModal]       = useState(false)
  const [allStudentsForReferral, setAllStudentsForReferral] = useState([])
  const [generatingInvoices, setGeneratingInvoices] = useState(false)
  const [xeroConnected, setXeroConnected]       = useState(null)  // null=loading, true/false
  const [xeroPushing, setXeroPushing]           = useState(false)
  const [xeroPushResult, setXeroPushResult]     = useState(null)  // { pushed, skipped, errors }
  const [invoiceViewMode, setInvoiceViewMode]   = useState('data')   // 'data' | 'cards'
  const [invoiceCardsData, setInvoiceCardsData] = useState([])
  const [loadingCards, setLoadingCards]         = useState(false)
  // Price confirm dialog (enrolments table — requires double-confirm before saving)
  const [priceConfirm, setPriceConfirm] = useState(null) // { rowId, col, oldVal, newVal } | null
  // Drop-in sessions interface view
  const [dropinViewMode, setDropinViewMode]     = useState('data')   // 'data' | 'sessions'
  const [lessonViewMode, setLessonViewMode]     = useState('lessons') // 'lessons' | 'level_tests'
  const [dropinSessions, setDropinSessions]     = useState([])
  const [dropinStudents, setDropinStudents]     = useState([])       // [{id, full_name}]
  const [loadingDropin, setLoadingDropin]       = useState(false)
  const [showAddSession, setShowAddSession]     = useState(false)
  const [editingSession, setEditingSession]     = useState(null)     // session object | null
  const [deleteSessionId, setDeleteSessionId]   = useState(null)
  const [addSigninFor, setAddSigninFor]         = useState(null)     // session id | null
  // Airtable-style reference data (linked-record resolution) + generic record panel
  const refData = useReferenceData()
  // Dropdown options for a cell, including dynamic lists sourced from reference
  // tables. classes.teacher is a free-text name column (kept for backward compat
  // with rollups / reports), but should be CHOSEN from the Tutors list rather
  // than typed by hand — so we offer the tutor names as dropdown options.
  const cellDropdownFor = useCallback((table, col) => {
    if (table === T_CLASSES && col === 'teacher') {
      const names = refData.options(T_TUTORS).map(o => o.label).filter(Boolean)
      return names.length ? Array.from(new Set(names)) : null
    }
    // tutors.active is a boolean column, but presented as an Active/Inactive picker.
    if (table === T_TUTORS && col === 'active') return ['Active', 'Inactive']
    return cellDropdown(table, col)
  }, [refData])
  const [detailRecord, setDetailRecord] = useState(null)   // { realTable, row } | null
  // Lesson detail sidebar
  const [lessonSidebar, setLessonSidebar]   = useState(null)   // lesson row object | null
  const [sidebarData, setSidebarData]       = useState(null)   // { roster, attendance, tutors, classes }
  const [sidebarLoading, setSidebarLoading] = useState(false)
  const [makeupStudent, setMakeupStudent]   = useState(null)   // student object | null
  const [makeupMode, setMakeupMode]         = useState(null)   // 'move' | 'onetoone' | 'cancel' | null
  const [makeupSaving, setMakeupSaving]     = useState(false)
  // cancel flow state
  const [cancelType,   setCancelType]       = useState('credit')
  const [cancelReason, setCancelReason]     = useState('')
  const [cancelCredit, setCancelCredit]     = useState(null)   // { amount, enrolment_price } | null
  // move-to-session picker state
  const [moveOptions, setMoveOptions]       = useState([])     // upcoming lessons for same course
  const [moveLoadingOpts, setMoveLoadingOpts] = useState(false)
  const [moveTargetId, setMoveTargetId]     = useState(null)
  // 1:1 makeup form state
  const [oneToOneTutorId, setOneToOneTutorId] = useState('')
  const [oneToOneDate, setOneToOneDate]     = useState('')
  const [oneToOneStart, setOneToOneStart]   = useState('')
  const [oneToOneEnd, setOneToOneEnd]       = useState('')
  const [oneToOneRoom, setOneToOneRoom]     = useState('')

  // Guardians table view ('families' groups rows by family_id — display only)
  const [guardianViewMode, setGuardianViewMode] = useState('families')  // 'families' | 'data'

  // Student directory view (cards mode for students table)
  const [studentViewMode, setStudentViewMode]             = useState('data')  // 'data' | 'cards'
  const [studentCardsData, setStudentCardsData]           = useState([])
  const [studentCardsParents, setStudentCardsParents]     = useState({})
  const [studentCardsEnrolments, setStudentCardsEnrolments] = useState({})
  const [studentCardsSearch, setStudentCardsSearch]       = useState('')
  const [studentCardsSelected, setStudentCardsSelected]   = useState(null) // student id
  const [loadingStudentCards, setLoadingStudentCards]     = useState(false)
  const [showAddStudentModal, setShowAddStudentModal]     = useState(false)
  // Maps table name → PostgreSQL OID (stable across renames). Used as
  // localStorage key suffix so column customisations survive table renames.
  const [tableOids, setTableOids]   = useState({})
  const [tableGroups, setTableGroups] = useState(() => {
    // Tables permanently hidden from the explorer (still exist in Supabase)
    const HIDDEN = new Set([T_ATTENDANCE, T_QUIZ_RESULTS])
    // Bump this whenever INITIAL_TABLE_GROUPS order/membership changes intentionally.
    // A mismatch clears the cached layout so the new defaults take effect immediately.
    const GROUPS_VERSION = 'v13' // v13: guardians added to Core

    try {
      const saved = typeof window !== 'undefined' && localStorage.getItem('cube_db_table_groups')
      if (!saved) return INITIAL_TABLE_GROUPS
      const { version, groups: parsed } = (() => {
        const raw = JSON.parse(saved)
        // Legacy format: plain array (no version)
        if (Array.isArray(raw)) return { version: null, groups: raw }
        return raw
      })()
      // Version mismatch → discard saved layout, use fresh defaults
      if (version !== GROUPS_VERSION) {
        localStorage.setItem('cube_db_table_groups', JSON.stringify({ version: GROUPS_VERSION, groups: INITIAL_TABLE_GROUPS }))
        return INITIAL_TABLE_GROUPS
      }
      // All tables currently placed anywhere in the saved layout
      const allPlaced = new Set(parsed.flatMap(g => g.tables))
      let changed = false
      const merged = parsed.map(g => {
        const initial = INITIAL_TABLE_GROUPS.find(ig => ig.label === g.label)

        // 1. Remove any tables that are now hidden
        const withoutHidden = g.tables.filter(t => !HIDDEN.has(t))
        if (withoutHidden.length !== g.tables.length) changed = true

        // 2. Add tables from INITIAL that are missing from ALL groups (truly new tables only —
        //    don't re-add tables that were intentionally moved to another group)
        if (!initial) return { ...g, tables: withoutHidden }
        const missing = initial.tables.filter(t => !allPlaced.has(t) && !HIDDEN.has(t))
        if (missing.length === 0) return { ...g, tables: withoutHidden }
        changed = true
        const next = [...withoutHidden]
        for (const t of missing) {
          const idx = initial.tables.indexOf(t)
          const insertBefore = initial.tables.slice(idx + 1).find(s => next.includes(s))
          if (insertBefore) next.splice(next.indexOf(insertBefore), 0, t)
          else next.push(t)
        }
        return { ...g, tables: next }
      })
      if (changed) {
        try { localStorage.setItem('cube_db_table_groups', JSON.stringify({ version: GROUPS_VERSION, groups: merged })) } catch {}
      }
      return merged
    } catch { return INITIAL_TABLE_GROUPS }
  })
  const [selectedTable, setSelectedTable] = useState('students')

  // Table data
  const [columns, setColumns]       = useState([])
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(false)
  const [tableError, setTableError] = useState(null)
  const [rowCounts, setRowCounts]   = useState({})
  const [parentMap, setParentMap]   = useState({})
  const [reloadKey, setReloadKey]   = useState(0)   // increment to force data reload

  // Enrolments (classes table only)
  const [enrolmentMap, setEnrolmentMap]     = useState({})   // { classId: [{id, full_name}] }
  const [allStudentsList, setAllStudentsList] = useState([])  // [{id, full_name}] for dropdown
  const [enrolPopover, setEnrolPopover]     = useState(null) // { classId, x, y } | null
  const [enrolSaving, setEnrolSaving]       = useState(false)

  // Siblings (students table only)
  const [siblingPopover, setSiblingPopover] = useState(null) // { studentId, x, y } | null
  const [siblingSaving, setSiblingSaving]   = useState(false)
  const [allStudentsForSiblings, setAllStudentsForSiblings] = useState([]) // [{id, full_name, family_id}]

  // Column layout
  const [columnOrder, setColumnOrder]   = useState([])
  const [columnWidths, setColumnWidths] = useState({})
  const [hiddenCols, setHiddenCols]     = useState(new Set())
  const dragColRef  = useRef(null)
  const dragOverRef = useRef(null)
  const [dragOver, setDragOver] = useState(null)
  const resizingRef = useRef(null)

  // Inline editing
  const [editingCell, setEditingCell] = useState(null)
  const [editValue, setEditValue]     = useState('')
  const [saving, setSaving]           = useState(false)
  const editInputRef = useRef(null)

  // Add / delete row
  const [addingRow, setAddingRow]       = useState(false)
  const [newRowData, setNewRowData]     = useState({})
  const [addingSaving, setAddingSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Lesson cancellation
  const [cancelModal,       setCancelModal]       = useState(null) // { row } | null
  const [lessonCancellations, setLessonCancellations] = useState({}) // { lessonId: [cancellation] }

  // Add Enrolment modal (enrolments table only)
  const [showAddEnrolmentModal, setShowAddEnrolmentModal] = useState(false)

  // Add Class modal (classes table only)
  const [showAddClassModal, setShowAddClassModal] = useState(false)
  const [newClassForm, setNewClassForm] = useState({ course_id: '', day_of_week: '', start_time: '', end_time: '' })
  const [coursesList, setCoursesList]   = useState([])
  // Add Lesson modal (lessons table) — a student-based lesson that shows on the calendar.
  const [showAddLessonModal, setShowAddLessonModal] = useState(false)
  const [addLessonSaving, setAddLessonSaving]       = useState(false)
  const [newLessonForm, setNewLessonForm] = useState({ lesson_type: 'level_test', level_test_build_ids: [], class_id: '', lesson_date: '', student_name: '', teacher_id: '', start_time: '', end_time: '', notes: '', room: '' })
  const [ltPickerOpen, setLtPickerOpen] = useState(false)   // checkbox dropdown open state
  const [levelTestsForLessons, setLevelTestsForLessons] = useState([])   // [{id, title, year, subject}] for the Level test link
  const [classesForLessons, setClassesForLessons] = useState([])         // [{id, class_name, day_of_week, start_time, end_time, room}] for the Class link
  const [addClassSaving, setAddClassSaving] = useState(false)
  // Add Course modal (form driven by the courses columns in tableMeta)
  const [showAddCourseModal, setShowAddCourseModal] = useState(false)
  const [newCourseForm, setNewCourseForm] = useState({})
  const [addCourseSaving, setAddCourseSaving] = useState(false)

  // Lessons table — class selector + generate
  const [lessonClassFilter, setLessonClassFilter]   = useState('')   // class_id to filter lessons by
  const [allClassesForFilter, setAllClassesForFilter] = useState([]) // for the dropdown
  const [generatingLessons, setGeneratingLessons]   = useState(false)
  const [allStaffForLessons, setAllStaffForLessons] = useState([])   // [{id, full_name}] for scheduled_teacher dropdown
  const [editingSchedTeacher, setEditingSchedTeacher] = useState(null) // rowId being edited

  // Term filter — applies to classes, enrolments, lessons, invoices
  // Tables where rows have a direct or indirect term_id relationship
  const TERM_SCOPED = useMemo(() => new Set([T_CLASSES, T_ENROLMENTS, T_LESSONS, T_INVOICES]), [])
  const [dbTermFilter, setDbTermFilter] = useState(null) // term id | null = all terms
  const [tutorStatusTab, setTutorStatusTab] = useState('active') // tutors view: 'active' | 'inactive' | 'all'
  const [studentStatusTab, setStudentStatusTab] = useState('active') // students view: 'active' | 'inactive' | 'all'

  // Search
  const [search, setSearch] = useState('')

  // Create / drop / rename table
  const [showCreateModal, setShowCreateModal]     = useState(false)
  const [dropConfirmCol,   setDropConfirmCol]      = useState(null)   // { col, realTable, table }
  const [dropColInput,     setDropColInput]         = useState('')
  const [ddlWorking, setDdlWorking]               = useState(false)
  const [ddlError, setDdlError]                   = useState(null)
  const [hoveredTable, setHoveredTable]           = useState(null)
  const [renamingTable, setRenamingTable]         = useState(null)
  // Drag-to-reorder sidebar tables
  const [dragTable, setDragTable]                 = useState(null)   // table name being dragged
  const [sidebarDragOver, setSidebarDragOver]     = useState(null)   // { table, position: 'before'|'after' }
  const dragRef                                   = useRef(null)     // stores { table, groupLabel }
  const [renameValue, setRenameValue]             = useState('')
  const [renameWorking, setRenameWorking]         = useState(false)
  const [renameError, setRenameError]             = useState(null)
  const renameInputRef = useRef(null)

  // Column context menu
  const [contextMenu, setContextMenu] = useState(null)  // { x, y, col } | null

  // Column rename (inline in header)
  const [renamingCol, setRenamingCol]           = useState(null)
  const [renameColValue, setRenameColValue]     = useState('')
  const [renameColWorking, setRenameColWorking] = useState(false)
  const [renameColError, setRenameColError]     = useState(null)
  const renameColInputRef = useRef(null)

  // Undo stack  (max 30)
  const [undoStack, setUndoStack] = useState([])
  const [undoing, setUndoing]     = useState(false)

  const allTables = tableGroups.flatMap(g => g.tables)

  // ── localStorage helpers ────────────────────────────────────────────────────
  // Returns the stable key for a table: its PostgreSQL OID if known, otherwise
  // its name. This means column customisations survive table renames because
  // PostgreSQL OIDs are assigned at creation and never change.
  const tableStableKey  = useCallback((table) => tableOids[table] ?? table, [tableOids])
  const saveOrder       = useCallback((table, order)  => { try { localStorage.setItem(`cube_db_order_${tableOids[table] ?? table}`,  JSON.stringify(order))  } catch {} }, [tableOids])
  const saveWidths      = useCallback((table, widths) => { try { localStorage.setItem(`cube_db_widths_${tableOids[table] ?? table}`, JSON.stringify(widths)) } catch {} }, [tableOids])
  const saveHidden      = useCallback((table, hidden) => { try { localStorage.setItem(`cube_db_hidden_${tableOids[table] ?? table}`, JSON.stringify([...hidden])) } catch {} }, [tableOids])

  // ── Sort & filter state (persisted per table, like column layout) ───────────
  const [sortRules, setSortRules]   = useState([])                       // [{ col, dir }]
  const [filterCfg, setFilterCfg]   = useState({ conj: 'and', conds: [] }) // { conj, conds: [{ col, op, value }] }
  const [sortOpen, setSortOpen]     = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const sortBtnRef   = useRef(null)
  const filterBtnRef = useRef(null)
  const saveSort   = useCallback((table, rules) => { try { localStorage.setItem(`cube_db_sort_${tableOids[table] ?? table}`,   JSON.stringify(rules)) } catch {} }, [tableOids])
  const saveFilter = useCallback((table, cfg)   => { try { localStorage.setItem(`cube_db_filter_${tableOids[table] ?? table}`, JSON.stringify(cfg))   } catch {} }, [tableOids])
  const updateSortRules = (next) => { setSortRules(next); saveSort(selectedTable, next) }
  const updateFilterCfg = (next) => { setFilterCfg(next); saveFilter(selectedTable, next) }
  const saveTableGroups = useCallback((groups) => { try { localStorage.setItem('cube_db_table_groups', JSON.stringify({ version: 'v6', groups })) } catch {} }, [])

  const pushUndo = useCallback((action) => {
    setUndoStack(prev => [...prev.slice(-29), action])
  }, [])

  // ── Auth ────────────────────────────────────────────────────────────────────
  // Role is stored in app_metadata (server-side only) so it survives DB changes.
  useEffect(() => {
    // Handle Xero OAuth redirect feedback
    const params = new URLSearchParams(window.location.search)
    const xeroParam = params.get('xero')
    if (xeroParam === 'connected') {
      setXeroConnected(true)
      window.history.replaceState({}, '', window.location.pathname)
    } else if (xeroParam === 'error') {
      alert('Xero connection failed. Please try again.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.push('/tutor'); return }
      setStaff(profile)
      // Fetch all terms (used for invoice generation selector + new class defaults)
      const terms = await fetchAllTerms()
      setAllTerms(terms || [])
      const cur = getCurrentTerm(terms)
      if (cur) {
        setCurrentTermId(cur.id)
        setCurrentTermName(cur.name || `Term ${cur.term_number} ${cur.year}`)
        setInvoiceTermId(cur.id)    // default invoice generation to current term
        setDbTermFilter(cur.id)     // default table term filter to current term
      }

      // Check Xero connection status
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        if (!s) return
        fetch('/api/xero/status', {
          headers: { Authorization: `Bearer ${s.access_token}` },
        }).then(r => r.json()).then(d => setXeroConnected(d.connected)).catch(() => setXeroConnected(false))
      })

      // Fetch PostgreSQL OIDs for all public tables. OIDs are stable across
      // renames, so we use them as localStorage key suffixes — column
      // customisations survive a table rename.
      try {
        const { data: oidRows } = await supabase
          .rpc('get_table_oids')
          .select()
        if (oidRows) {
          const oidMap = Object.fromEntries(oidRows.map(r => [r.relname, String(r.oid)]))
          setTableOids(oidMap)
          // Migrate any existing name-based localStorage keys → OID-based keys
          for (const [name, oid] of Object.entries(oidMap)) {
            for (const suffix of ['order', 'widths']) {
              const oldKey = `cube_db_${suffix}_${name}`
              const newKey = `cube_db_${suffix}_${oid}`
              const val = localStorage.getItem(oldKey)
              if (val && !localStorage.getItem(newKey)) {
                localStorage.setItem(newKey, val)
                localStorage.removeItem(oldKey)
              }
            }
          }
        }
      } catch { /* OIDs optional — falls back to name-based keys */ }
    })()
  }, [])

  // ── Row counts ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!staff) return
    allTables.forEach(async (t) => {
      const v = VIRTUAL[t]
      let q = supabase.from(v ? v.realTable : t).select('*', { count:'exact', head:true })
      if (v?.filterCol) q = v.filterOp === 'in' ? q.in(v.filterCol, v.filterVal) : q.eq(v.filterCol, v.filterVal)
      const { count } = await q
      if (count !== null) setRowCounts(prev => ({ ...prev, [t]: count }))
    })
  }, [staff, tableGroups])

  // ── Load selected table ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!staff || !selectedTable) return
    setLoading(true); setTableError(null)
    setColumns([]); setRows([]); setParentMap({})
    setEditingCell(null); setAddingRow(false); setNewRowData({})
    setSearch(''); setDeleteConfirm(null); setContextMenu(null)

    const v = VIRTUAL[selectedTable]
    const realTable = v ? v.realTable : selectedTable
    const selectStr = v?.showCols ? v.showCols.join(',') : '*'

    ;(async () => {
      // For enrolments + lessons, term filtering requires resolving class IDs first
      let termClassIds = null
      if (dbTermFilter && (selectedTable === T_ENROLMENTS || selectedTable === T_LESSONS)) {
        const { data: termClasses } = await supabase
          .from(T_CLASSES).select('id').eq('term_id', dbTermFilter)
        termClassIds = (termClasses || []).map(c => c.id)
      }

      let q = supabase.from(realTable).select(selectStr).limit(500)
      if (v?.filterCol) q = v.filterOp === 'in' ? q.in(v.filterCol, v.filterVal) : q.eq(v.filterCol, v.filterVal)
      // Term filter — direct for classes/invoices; via class_id list for enrolments/lessons
      if (dbTermFilter) {
        if (selectedTable === T_CLASSES || selectedTable === T_INVOICES) {
          q = q.eq('term_id', dbTermFilter)
        } else if ((selectedTable === T_ENROLMENTS || selectedTable === T_LESSONS) && termClassIds) {
          if (termClassIds.length === 0) {
            // No classes in this term — only show unassigned enrolments
            if (selectedTable === T_ENROLMENTS) {
              q = q.is('class_id', null)
            } else {
              setColumns([]); setRows([]); setLoading(false); return
            }
          } else if (selectedTable === T_ENROLMENTS) {
            // Include enrolments assigned to this term's classes + unassigned (null class_id) trial enrolments
            q = q.or(`class_id.in.(${termClassIds.join(',')}),class_id.is.null`)
          } else {
            // Lessons: this term's class lessons + ad-hoc lessons (level tests / 1:1s, null class_id)
            q = q.or(`class_id.in.(${termClassIds.join(',')}),class_id.is.null`)
          }
        }
      }
      // Lessons table: also filter by selected class if one is chosen
      if (selectedTable === 'lessons' && lessonClassFilter) q = q.eq('class_id', Number(lessonClassFilter))

    q.then(async ({ data, error }) => {
      if (error) { setTableError(error.message); setLoading(false); return }
      const r = data || []

      let cols = v?.showCols
        ? v.showCols.filter(c => r.length === 0 || c in (r[0] ?? {}))
        : r.length > 0 ? Object.keys(r[0]) : []

      // Strip system/hidden columns (e.g. role — managed via auth app_metadata)
      if (v?.excludeCols?.length) cols = cols.filter(c => !v.excludeCols.includes(c))

      let enrichedRows = r

      // ── Apply A/B/C class labels when viewing the classes table ────────────
      if (selectedTable === T_CLASSES && r.length > 0) {
        const labelMap = buildClassLabelMap(r)
        enrichedRows = r.map(row => ({
          ...row,
          class_name: labelMap.get(row.id) ?? row.class_name,
        }))
      }

      if (v?.joinParents && r.length > 0) {
        const ids = r.map(s => s.id)
        const { data: parentRows } = await supabase.from(T_PARENTS).select('student_id, full_name, relationship, email, phone').in('student_id', ids)
        const pMap = {}
        for (const p of parentRows || []) pMap[p.student_id] = p
        setParentMap(pMap)
        enrichedRows = r.map(s => ({ ...s, guardian_name: pMap[s.id]?.full_name ?? null, guardian_relationship: pMap[s.id]?.relationship ?? null, guardian_email: pMap[s.id]?.email ?? null, guardian_phone: pMap[s.id]?.phone ?? null }))
        cols = [...cols, ...GUARDIAN_COLS]
      }

      if (v?.joinNames && r.length > 0) {
        const studentIds = [...new Set(r.map(row => row.student_id).filter(Boolean))]
        const classIds   = [...new Set(r.map(row => row.class_id).filter(Boolean))]
        const [{ data: studentRows }, { data: classRows }, { data: allClassRows }] = await Promise.all([
          supabase.from(T_STUDENTS).select('id, full_name').in('id', studentIds),
          supabase.from(T_CLASSES).select('id, class_name').in('id', classIds),
          supabase.from(T_CLASSES).select('id, class_name'),
        ])
        const classLabelMap = buildClassLabelMap(allClassRows || [])
        const sMap = Object.fromEntries((studentRows || []).map(s => [s.id, s.full_name]))
        const cMap = Object.fromEntries((classRows  || []).map(c => [c.id, classLabelMap.get(c.id) ?? c.class_name]))
        enrichedRows = r.map(row => ({ ...row, student_name: sMap[row.student_id] ?? null, class_name: cMap[row.class_id] ?? null }))
        // Show name cols first (after id), then the raw FK cols at the end
        const base = cols.filter(c => !ENROLMENT_NAME_COLS.includes(c))
        const idCol = base.includes('id') ? ['id'] : []
        const rest  = base.filter(c => c !== 'id')
        cols = [...idCol, ...ENROLMENT_NAME_COLS, ...rest]
      }

      if (v?.joinTermName && r.length > 0) {
        const termIds = [...new Set(r.map(row => row.term_id).filter(Boolean))]
        const { data: termRows } = await supabase.from(T_TERMS).select('id, name, term_number, year').in('id', termIds)
        const tMap = Object.fromEntries((termRows || []).map(t => [t.id, t.name || `Term ${t.term_number} ${t.year}`]))
        enrichedRows = enrichedRows.map(row => ({ ...row, [TERM_NAME_COL]: tMap[row.term_id] ?? null }))
        // Show term_name right after id, hide the raw term_id uuid
        const base = cols.filter(c => c !== TERM_NAME_COL && c !== 'term_id')
        const idCol = base.includes('id') ? ['id'] : []
        const rest  = base.filter(c => c !== 'id')
        cols = [...idCol, TERM_NAME_COL, ...rest]
      }

      if (v?.joinInvoiceFamily && enrichedRows.length > 0) {
        const familyIds    = [...new Set(enrichedRows.map(row => row.family_id).filter(Boolean))]
        const soloIds      = [...new Set(enrichedRows.map(row => row.student_id).filter(Boolean))]
        const [famRes, soloRes] = await Promise.all([
          familyIds.length ? supabase.from(T_STUDENTS).select('id, full_name, family_id').in('family_id', familyIds) : { data: [] },
          soloIds.length   ? supabase.from(T_STUDENTS).select('id, full_name').in('id', soloIds) : { data: [] },
        ])
        // Build family_id → display name map
        const famStudents = famRes.data || []
        const familyNameMap = {}
        for (const s of famStudents) {
          if (!familyNameMap[s.family_id]) familyNameMap[s.family_id] = []
          familyNameMap[s.family_id].push(s.full_name)
        }
        const soloNameMap = Object.fromEntries((soloRes.data || []).map(s => [s.id, s.full_name]))
        enrichedRows = enrichedRows.map(row => {
          let name = null
          if (row.family_id != null) {
            const names = familyNameMap[row.family_id] || []
            const lastName = names[0]?.split(' ').pop() ?? ''
            const firstNames = names.map(n => n.split(' ').slice(0, -1).join(' ') || n)
            name = firstNames.length <= 1 ? names[0] : `${firstNames.slice(0,-1).join(', ')} & ${firstNames[firstNames.length-1]} ${lastName}`.trim()
          } else if (row.student_id != null) {
            name = soloNameMap[row.student_id] ?? null
          }
          return { ...row, [INVOICE_FAMILY_COL]: name }
        })
        // Place family_name right after term_name (or after id), hide raw IDs
        const base = cols.filter(c => c !== INVOICE_FAMILY_COL && c !== 'family_id' && c !== 'student_id')
        const idCol   = base.includes('id') ? ['id'] : []
        const termCol = base.includes(TERM_NAME_COL) ? [TERM_NAME_COL] : []
        const rest    = base.filter(c => c !== 'id' && c !== TERM_NAME_COL)
        cols = [...idCol, ...termCol, INVOICE_FAMILY_COL, ...rest]
      }

      if (v?.joinCourseName && r.length > 0) {
        const courseIds = [...new Set(enrichedRows.map(row => row.course_id).filter(Boolean))]
        if (courseIds.length > 0) {
          const { data: courseRows } = await supabase.from(T_COURSES).select('id, course_name, course_code').in('id', courseIds)
          const cMap = Object.fromEntries((courseRows || []).map(c => [c.id, `${c.course_name} (${c.course_code})`]))
          enrichedRows = enrichedRows.map(row => ({ ...row, [COURSE_NAME_COL]: cMap[row.course_id] ?? null }))
        } else {
          enrichedRows = enrichedRows.map(row => ({ ...row, [COURSE_NAME_COL]: null }))
        }
        // Show course_name after term_name (or after id), hide raw course_id
        const base = cols.filter(c => c !== COURSE_NAME_COL && c !== 'course_id')
        const idCol = base.includes('id') ? ['id'] : []
        const termCol = base.includes(TERM_NAME_COL) ? [TERM_NAME_COL] : []
        const rest = base.filter(c => c !== 'id' && c !== TERM_NAME_COL)
        cols = [...idCol, ...termCol, COURSE_NAME_COL, ...rest]
      }

      if (v?.joinLessonClassName && enrichedRows.length > 0) {
        const classIds = [...new Set(enrichedRows.map(row => row.class_id).filter(Boolean))]
        if (classIds.length > 0) {
          const [{ data: classRows }, { data: allClassRowsForLessons }] = await Promise.all([
            supabase.from(T_CLASSES).select('id, class_name, day_of_week').in('id', classIds),
            supabase.from(T_CLASSES).select('id, class_name'),
          ])
          const lessonClassLabelMap = buildClassLabelMap(allClassRowsForLessons || [])
          const cMap = Object.fromEntries((classRows || []).map(c => [c.id, `${lessonClassLabelMap.get(c.id) ?? c.class_name} (${c.day_of_week})`]))
          enrichedRows = enrichedRows.map(row => ({ ...row, [LESSON_CLASS_COL]: cMap[row.class_id] ?? null }))
        } else {
          enrichedRows = enrichedRows.map(row => ({ ...row, [LESSON_CLASS_COL]: null }))
        }
        // Fetch staff inline so name resolution is always synchronous with the data load
        const [{ data: _tutors }, { data: _directors }] = await Promise.all([
          supabase.from(T_TUTORS).select('id, full_name'),
          supabase.from(T_ADMINS).select('id, full_name'),
        ])
        const _allStaff = [...(_tutors || []), ...(_directors || [])]
        setAllStaffForLessons(
          _allStaff.sort((a, b) => a.full_name.localeCompare(b.full_name))
        )
        const staffById = Object.fromEntries(_allStaff.map(s => [s.id, s.full_name]))
        enrichedRows = enrichedRows.map(row => ({
          ...row,
          [LESSON_SCHED_TEACHER_COL]: row.scheduled_teacher_id ? (staffById[row.scheduled_teacher_id] ?? null) : null,
        }))

        // Column order: id | class_label | week | lesson_date | main_teacher | scheduled_teacher | …rest
        const base = cols.filter(c => c !== LESSON_CLASS_COL && c !== 'class_id' && c !== 'scheduled_teacher_id')
        const idCol = base.includes('id') ? ['id'] : []
        const rest  = base.filter(c => c !== 'id')
        const weekCol   = rest.includes(LESSON_WEEK_COL) ? [LESSON_WEEK_COL] : []
        const dateCol   = rest.includes('lesson_date') ? ['lesson_date'] : []
        const mainCol   = rest.includes(LESSON_MAIN_TEACHER_COL) ? [LESSON_MAIN_TEACHER_COL] : []
        const remaining = rest.filter(c => c !== 'lesson_date' && c !== LESSON_WEEK_COL && c !== LESSON_MAIN_TEACHER_COL)
        cols = [...idCol, LESSON_CLASS_COL, ...weekCol, ...dateCol, ...mainCol, LESSON_SCHED_TEACHER_COL, ...remaining]
        // Sort rows by class_label then lesson_date
        enrichedRows = [...enrichedRows].sort((a, b) => {
          const cl = (a[LESSON_CLASS_COL] || '').localeCompare(b[LESSON_CLASS_COL] || '')
          if (cl !== 0) return cl
          return (a.lesson_date || '').localeCompare(b.lesson_date || '')
        })
      }

      setColumns(cols); setRows(enrichedRows); setLoading(false)

      // Load cancellations for lessons table
      if (selectedTable === T_LESSONS && enrichedRows.length > 0) {
        const lessonIds = enrichedRows.map(r => r.id)
        supabase
          .from('lesson_cancellations')
          .select('id, lesson_id, student_id, type, reason, credit_amount, held_for_next_term, cancelled_at, undone_at, students(full_name)')
          .in('lesson_id', lessonIds)
          .is('undone_at', null)
          .then(({ data: cancRows }) => {
            const map = {}
            for (const c of cancRows || []) {
              if (!map[c.lesson_id]) map[c.lesson_id] = []
              map[c.lesson_id].push(c)
            }
            setLessonCancellations(map)
          })
      }
    })
    })()  // close async IIFE
  }, [selectedTable, staff, reloadKey, lessonClassFilter, dbTermFilter])

  // ── Load enrolments when classes table is active ────────────────────────────
  useEffect(() => {
    if (selectedTable !== 'classes' || !staff) return
    setEnrolmentMap({}); setAllStudentsList([])
    ;(async () => {
      const [{ data: sc }, { data: studs }] = await Promise.all([
        supabase.from(T_ENROLMENTS).select('class_id, student_id, students(id, full_name)'),
        supabase.from(T_STUDENTS).select('id, full_name').order('full_name'),
      ])
      const map = {}
      for (const row of sc || []) {
        if (!map[row.class_id]) map[row.class_id] = []
        if (row.students) map[row.class_id].push({ id: row.student_id, full_name: row.students.full_name })
      }
      // Sort each class's student list alphabetically
      for (const k of Object.keys(map)) map[k].sort((a, b) => a.full_name.localeCompare(b.full_name))
      setEnrolmentMap(map)
      setAllStudentsList(studs || [])
    })()
  }, [selectedTable, staff, reloadKey])

  // ── Load all students for sibling management when students table is active ────
  useEffect(() => {
    if (selectedTable !== 'students' || !staff) return
    ;(async () => {
      const { data } = await supabase
        .from(T_STUDENTS)
        .select('id, full_name, family_id')
        .order('full_name')
      setAllStudentsForSiblings(data || [])
    })()
  }, [selectedTable, staff, reloadKey])

  // ── Restore column layout from localStorage when columns load ───────────────
  useEffect(() => {
    if (columns.length === 0) return
    try {
      const stableKey   = tableStableKey(selectedTable)
      const savedOrder  = JSON.parse(localStorage.getItem(`cube_db_order_${stableKey}`)  ?? 'null')
      const savedWidths = JSON.parse(localStorage.getItem(`cube_db_widths_${stableKey}`) ?? 'null')
      const savedHidden = JSON.parse(localStorage.getItem(`cube_db_hidden_${stableKey}`) ?? 'null')

      let order
      if (savedOrder) {
        const valid   = savedOrder.filter(c => columns.includes(c))
        const newCols = columns.filter(c => !savedOrder.includes(c))
        order = [...valid, ...newCols]
      } else {
        order = columns
      }
      setColumnOrder(order)
      const defaults = Object.fromEntries(columns.map(c => [c, defaultWidth(c)]))
      setColumnWidths({ ...defaults, ...(savedWidths ?? {}) })
      // No saved layout → start with system/internal columns hidden (from lib/tableMeta).
      // Users can unhide as before; once they save a layout it always wins.
      const metaTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
      setHiddenCols(new Set(savedHidden ?? defaultHiddenCols(metaTable, columns)))
      // Restore saved sort/filter (drop rules whose column no longer exists)
      const savedSort   = JSON.parse(localStorage.getItem(`cube_db_sort_${stableKey}`)   ?? '[]')
      const savedFilter = JSON.parse(localStorage.getItem(`cube_db_filter_${stableKey}`) ?? 'null')
      setSortRules(Array.isArray(savedSort) ? savedSort.filter(r => r?.col && columns.includes(r.col)) : [])
      setFilterCfg(savedFilter && Array.isArray(savedFilter.conds)
        ? { conj: savedFilter.conj === 'or' ? 'or' : 'and', conds: savedFilter.conds.filter(c => c?.col && columns.includes(c.col)) }
        : { conj: 'and', conds: [] })
    } catch {
      setColumnOrder(columns)
      setColumnWidths(Object.fromEntries(columns.map(c => [c, defaultWidth(c)])))
      setHiddenCols(new Set())
      setSortRules([])
      setFilterCfg({ conj: 'and', conds: [] })
    }
    setSortOpen(false); setFilterOpen(false)
  }, [columns, selectedTable])

  // ── Focus effects ───────────────────────────────────────────────────────────
  useEffect(() => { if (editingCell   && editInputRef.current)    { editInputRef.current.focus();    editInputRef.current.select?.()    } }, [editingCell])
  useEffect(() => { if (renamingTable && renameInputRef.current)  { renameInputRef.current.focus();  renameInputRef.current.select()  } }, [renamingTable])
  useEffect(() => { if (renamingCol   && renameColInputRef.current){ renameColInputRef.current.focus(); renameColInputRef.current.select() } }, [renamingCol])

  // ── Ctrl/Cmd+Z → explorer undo stack ────────────────────────────────────────
  // The shortcut itself is bound once by <GlobalUndo /> in TutorNav (which also
  // ignores it while typing, so native text undo works in cell inputs). While
  // this page is mounted it takes over the shortcut with its richer stack.
  useEffect(() => setUndoHandler(async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last) { announceUndo('Nothing to undo', false); return }
    await handleUndo()
    announceUndo(undoLabel(last).replace(/^Undo /, 'Undone: '), true)
  }), [undoStack, selectedTable])

  const pkCol = getPkCol(columns)

  // ── Resize ──────────────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e, col) => {
    e.preventDefault(); e.stopPropagation()
    resizingRef.current = { col, startX: e.clientX, startWidth: columnWidths[col] ?? defaultWidth(col) }
    const onMove = (ev) => {
      if (!resizingRef.current) return
      const { col, startX, startWidth } = resizingRef.current
      setColumnWidths(prev => ({ ...prev, [col]: Math.max(60, startWidth + ev.clientX - startX) }))
    }
    const onUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setColumnWidths(current => { saveWidths(selectedTable, current); return current })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [columnWidths, selectedTable, saveWidths])

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────
  const handleDragStart = (e, col) => { dragColRef.current = col; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col) }
  const handleDragOver  = (e, col) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverRef.current !== col) { dragOverRef.current = col; setSidebarDragOver(col) } }
  const handleDragLeave = () => { dragOverRef.current = null; setSidebarDragOver(null) }
  const handleDrop = (e, targetCol) => {
    e.preventDefault()
    const srcCol = dragColRef.current; dragColRef.current = null; dragOverRef.current = null; setSidebarDragOver(null)
    if (!srcCol || srcCol === targetCol) return
    setColumnOrder(prev => {
      const next = [...prev]
      const from = next.indexOf(srcCol); const to = next.indexOf(targetCol)
      if (from === -1 || to === -1) return prev
      next.splice(from, 1); next.splice(to, 0, srcCol)
      saveOrder(selectedTable, next)
      return next
    })
  }
  const handleDragEnd = () => { dragColRef.current = null; dragOverRef.current = null; setSidebarDragOver(null) }

  // ── Cell editing ─────────────────────────────────────────────────────────────
  const isGuardianCol = (col) => col in PARENT_COL_MAP
  // Read-only joined/derived columns are table-specific: they only appear (and
  // are non-editable) on the virtual views that join them. The SAME names are
  // real, editable columns on their own tables — e.g. course_name on `courses`
  // and class_name on `classes` — so we must scope by selectedTable, not match
  // the column name globally.
  const isNameCol = (col) => (READONLY_JOIN_COLS[selectedTable] || []).includes(col)

  const handleCellClick = (rowId, col, currentVal) => {
    if (col === pkCol || isNameCol(col)) return
    setDeleteConfirm(null); setContextMenu(null)
    setEditingCell({ rowId, col })
    // tutors.active (boolean) is edited via an Active/Inactive dropdown.
    if (selectedTable === T_TUTORS && col === 'active') {
      setEditValue(currentVal === false || currentVal === 'false' ? 'Inactive' : 'Active')
      return
    }
    setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal))
  }

  // Sync a field change into invoiceCardsData so cards stay live with the data view
  const syncInvoiceCard = (rowId, col, newVal) => {
    setInvoiceCardsData(d => d.map(c => c.id === rowId ? { ...c, [col]: newVal } : c))
  }

  const handleCellSave = async () => {
    if (!editingCell) { setEditingCell(null); return }
    const { rowId, col } = editingCell
    // Price on enrolments requires a confirmation step before writing to DB
    if (selectedTable === T_ENROLMENTS && col === 'price') {
      const oldVal = rows.find(r => r[pkCol] === rowId)?.[col] ?? null
      const newVal = editValue === '' ? null : editValue
      setEditingCell(null)
      setPriceConfirm({ rowId, col, oldVal, newVal })
      return
    }
    // Soft validation from lib/tableMeta — warns, never blocks silently or rewrites.
    {
      const metaTable = isGuardianCol(col) ? T_PARENTS : (VIRTUAL[selectedTable]?.realTable ?? selectedTable)
      const metaCol   = isGuardianCol(col) ? PARENT_COL_MAP[col] : col
      const warning   = validateValue(metaTable, metaCol, editValue === '' ? null : editValue)
      if (warning && !window.confirm(`⚠ ${warning}\n\nSave anyway?`)) { setEditingCell(null); return }
    }
    setEditingCell(null); setSaving(true)
    const newVal = editValue.trim() === '' ? null : editValue.trim()  // whitespace never persists
    const prevRows = rows
    const oldVal = rows.find(r => r[pkCol] === rowId)?.[col] ?? null
    if (String(oldVal ?? '') === String(newVal ?? '')) { setSaving(false); return } // no change
    setRows(prev => prev.map(r => r[pkCol] === rowId ? { ...r, [col]: newVal } : r))
    if (isGuardianCol(col)) {
      const parentCol = PARENT_COL_MAP[col]
      const existing  = parentMap[rowId]
      let error
      if (existing) {
        ;({ error } = await supabase.from(T_PARENTS).update({ [parentCol]: newVal }).eq('student_id', rowId))
      } else {
        const { data: newParent, error: insErr } = await supabase.from(T_PARENTS).insert({ student_id: rowId, [parentCol]: newVal }).select().single()
        error = insErr
        if (newParent) setParentMap(prev => ({ ...prev, [rowId]: newParent }))
      }
      if (error) { alert(`Save failed: ${error.message}`); setRows(prevRows) }
      else pushUndo({ type: 'edit_cell', table: selectedTable, realTable: T_PARENTS, pkCol: 'student_id', rowId, col: PARENT_COL_MAP[col], oldVal, newVal })
    } else {
      const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
      const { error } = await supabase.from(realTable).update({ [col]: newVal }).eq(pkCol, rowId)
      if (error) { alert(`Save failed: ${error.message}`); setRows(prevRows) }
      else {
        pushUndo({ type: 'edit_cell', table: selectedTable, realTable, pkCol, rowId, col, oldVal, newVal })
        if (selectedTable === T_INVOICES) syncInvoiceCard(rowId, col, newVal)
      }
    }
    setSaving(false)
  }

  // Dropdown cells: save immediately with the chosen value (avoids stale-closure
  // bug where onBlur fires before the onChange state update has re-rendered).
  const handleDropdownSave = async (value) => {
    if (!editingCell) return
    const { rowId, col } = editingCell
    setEditingCell(null); setSaving(true)
    let newVal = String(value ?? '').trim() === '' ? null : String(value).trim()
    // tutors.active is stored as a boolean even though the picker shows Active/Inactive.
    if (selectedTable === T_TUTORS && col === 'active') newVal = value === 'Active'
    const prevRows = rows
    const oldVal = rows.find(r => r[pkCol] === rowId)?.[col] ?? null
    if (String(oldVal ?? '') === String(newVal ?? '')) { setSaving(false); return }
    setRows(prev => prev.map(r => r[pkCol] === rowId ? { ...r, [col]: newVal } : r))
    const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
    const { error } = await supabase.from(realTable).update({ [col]: newVal }).eq(pkCol, rowId)
    if (error) { alert(`Save failed: ${error.message}`); setRows(prevRows) }
    else {
      pushUndo({ type: 'edit_cell', table: selectedTable, realTable, pkCol, rowId, col, oldVal, newVal })
      if (selectedTable === T_INVOICES) syncInvoiceCard(rowId, col, newVal)
    }
    setSaving(false)
  }

  const handleCellKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); handleCellSave() }
    if (e.key === 'Escape') { setEditingCell(null) }
    if (e.key === 'Tab')    { e.preventDefault(); handleCellSave() }
  }

  // ── Airtable-style record detail panel ──────────────────────────────────────
  // Open the current grid row (uses the real table behind any virtual view).
  const openRowDetail = (rowObj) => {
    const rt = VIRTUAL[selectedTable]?.realTable ?? selectedTable
    setDetailRecord({ realTable: rt, row: rowObj })
  }
  // Open a linked record (clicked from a linked-record badge) by id.
  const openLinkedDetail = async (refTable, id) => {
    if (id === null || id === undefined || id === '') return
    const { data } = await supabase.from(refTable).select('*').eq('id', id).single()
    if (data) setDetailRecord({ realTable: refTable, row: data })
  }
  // Meta lookup helpers that respect virtual tables and the guardian sub-table.
  const metaTableFor = (col) => isGuardianCol(col) ? T_PARENTS : (VIRTUAL[selectedTable]?.realTable ?? selectedTable)
  const metaColFor   = (col) => isGuardianCol(col) ? PARENT_COL_MAP[col] : col

  // ── Enrolment price confirmed save ──────────────────────────────────────────
  const handlePriceConfirm = async () => {
    if (!priceConfirm) return
    const { rowId, col, newVal } = priceConfirm
    setPriceConfirm(null); setSaving(true)
    const parsedVal = newVal === '' || newVal === null ? null : newVal
    const prevRows = rows
    setRows(prev => prev.map(r => r[pkCol] === rowId ? { ...r, [col]: parsedVal } : r))
    const { error } = await supabase.from(T_ENROLMENTS).update({ [col]: parsedVal }).eq(pkCol, rowId)
    if (error) { alert(`Save failed: ${error.message}`); setRows(prevRows) }
    setSaving(false)
  }

  // ── Generate invoices for a term ─────────────────────────────────────────────
  const handleGenerateInvoices = async () => {
    if (!invoiceTermId) return
    setGeneratingInvoices(true)
    const { error } = await supabase.rpc('generate_invoices_for_term', { p_term_id: invoiceTermId })
    if (error) alert(`Generate failed: ${error.message}`)
    setReloadKey(k => k + 1)
    setGeneratingInvoices(false)
  }

  // ── Push invoices to Xero ─────────────────────────────────────────────────────
  const handlePushToXero = async () => {
    if (!invoiceTermId) return
    setXeroPushing(true)
    setXeroPushResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/xero/push', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body:    JSON.stringify({ term_id: invoiceTermId }),
      })
      const rawText = await res.text()
      console.log('Xero push response status:', res.status, 'body:', rawText.slice(0, 500))
      let result
      try { result = JSON.parse(rawText) } catch { throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 300) || '(empty body)'}`) }
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`)
      setXeroPushResult(result)
      if (result.errors?.length) console.error('Xero push errors:', JSON.stringify(result.errors, null, 2))
      setReloadKey(k => k + 1)
    } catch (err) {
      alert('Xero push failed: ' + err.message)
    }
    setXeroPushing(false)
  }

  // ── Add row ──────────────────────────────────────────────────────────────────
  const handleAddRow = async () => {
    setAddingSaving(true)
    const vConfig   = VIRTUAL[selectedTable]
    const realTable = vConfig?.realTable ?? selectedTable
    const payload   = { ...(vConfig?.defaultRow ?? {}) }
    // Auto-fill term_id for new classes rows — use the term selected in the Term
    // filter so rows land in the term you're viewing; fall back to current term.
    if (selectedTable === 'classes') {
      const targetTerm = dbTermFilter || currentTermId
      if (targetTerm) payload.term_id = targetTerm
    }
    for (const [k, v] of Object.entries(newRowData)) {
      if (k === pkCol || isGuardianCol(k) || k === TERM_NAME_COL || k === COURSE_NAME_COL || k === LESSON_CLASS_COL || k === LESSON_WEEK_COL || k === LESSON_MAIN_TEACHER_COL || k === LESSON_SCHED_TEACHER_COL) continue
      payload[k] = v === '' ? null : v
    }
    const { data, error } = await supabase.from(realTable).insert(payload).select().single()
    if (error) { alert(`Insert failed: ${error.message}`); setAddingSaving(false); return }

    const guardianPayload = {}
    for (const gc of GUARDIAN_COLS) {
      const gv = newRowData[gc]; if (gv?.trim()) guardianPayload[PARENT_COL_MAP[gc]] = gv.trim()
    }
    if (Object.keys(guardianPayload).length > 0) {
      const { data: newParent } = await supabase.from(T_PARENTS).insert({ student_id: data.id, ...guardianPayload }).select().single()
      if (newParent) setParentMap(prev => ({ ...prev, [data.id]: newParent }))
    }
    const enriched = { ...data, guardian_name: guardianPayload.full_name ?? null, guardian_relationship: guardianPayload.relationship ?? null, guardian_email: guardianPayload.email ?? null, guardian_phone: guardianPayload.phone ?? null }
    setRows(prev => [enriched, ...prev])
    if (columns.length === 0) setColumns(Object.keys(enriched))
    setNewRowData({}); setAddingRow(false)
    setRowCounts(prev => ({ ...prev, [selectedTable]: (prev[selectedTable] ?? 0) + 1 }))
    pushUndo({ type: 'add_row', table: selectedTable, realTable, pkCol, rowId: data[pkCol ?? 'id'] })
    setAddingSaving(false)
  }

  // ── Add Class modal ───────────────────────────────────────────────────────────
  const openAddClassModal = async () => {
    setShowAddClassModal(true)
    setNewClassForm({ course_id: '', day_of_week: '', start_time: '', end_time: '' })
    if (coursesList.length === 0) {
      const { data } = await supabase.from(T_COURSES).select('id, course_name, course_code').order('course_name')
      setCoursesList(data || [])
    }
  }

  const handleAddClass = async () => {
    if (!newClassForm.course_id || !newClassForm.day_of_week || !newClassForm.start_time || !newClassForm.end_time) return
    setAddClassSaving(true)
    const course = coursesList.find(c => c.id === Number(newClassForm.course_id))
    const payload = {
      class_name:  course?.course_name ?? '',
      course_id:   Number(newClassForm.course_id),
      day_of_week: newClassForm.day_of_week,
      start_time:  newClassForm.start_time,
      end_time:    newClassForm.end_time,
      term_id:     dbTermFilter || currentTermId || null,
    }
    const { data, error } = await supabase.from(T_CLASSES).insert(payload).select().single()
    if (!error && data) {
      const enriched = {
        ...data,
        [COURSE_NAME_COL]: course ? `${course.course_name} (${course.course_code})` : null,
        [TERM_NAME_COL]:   currentTermName || null,
      }
      // Reload so all class labels (A/B/C) are recomputed for the full set
      setReloadKey(k => k + 1)
    }
    setAddClassSaving(false)
    setShowAddClassModal(false)
  }

  // ── Add Lesson modal ──────────────────────────────────────────────────────────
  // A guided form for a student-based (1:1) lesson. It stores the student on
  // makeup_student_id and the teacher on scheduled_teacher_id so the lesson shows
  // up on the calendar's 1:1 overlay.
  const openAddLessonModal = async (lessonType = 'level_test') => {
    setNewLessonForm({ lesson_type: lessonType === 'class' ? 'class' : 'level_test', level_test_build_ids: [], class_id: '', lesson_date: '', student_name: '', teacher_id: '', start_time: '', end_time: '', notes: '', room: '' })
    setLtPickerOpen(false)
    setShowAddLessonModal(true)
    setDeleteConfirm(null)
    if (levelTestsForLessons.length === 0) {
      const { data } = await supabase.from('booklet_builds')
        .select('id, title, year, subject')
        .eq('doc_type', 'level_test')
        .order('updated_at', { ascending: false })
      setLevelTestsForLessons(data || [])
    }
    if (classesForLessons.length === 0) {
      const { data } = await supabase.from(T_CLASSES)
        .select('id, class_name, day_of_week, start_time, end_time, room')
        .order('class_name')
      const labelMap = buildClassLabelMap(data || [])
      setClassesForLessons((data || []).map(c => ({ ...c, label: labelMap.get(c.id) ?? c.class_name })))
    }
  }

  // Picking a class auto-fills the time + room from its weekly schedule (editable).
  const pickLessonClass = (classId) => {
    const c = classesForLessons.find(x => String(x.id) === String(classId))
    setNewLessonForm(p => ({
      ...p,
      class_id: classId,
      start_time: c?.start_time ? String(c.start_time).slice(0, 5) : p.start_time,
      end_time:   c?.end_time ? String(c.end_time).slice(0, 5) : p.end_time,
      room:       c?.room ?? p.room,
    }))
  }

  const lessonFormValid = (() => {
    const f = newLessonForm
    if (!f.lesson_date || !f.start_time) return false
    if (f.lesson_type === 'class') return !!f.class_id
    if (f.lesson_type === 'level_test') return !!(f.student_name.trim() && f.level_test_build_ids.length)
    return !!(f.student_name.trim() && f.teacher_id)   // one_on_one
  })()

  const handleAddLesson = async () => {
    if (!lessonFormValid) return
    setAddLessonSaving(true)
    const f = newLessonForm
    const isLevelTest = f.lesson_type === 'level_test'
    const isClass = f.lesson_type === 'class'
    // A "Class" lesson is a normal class lesson (class_id set), stored exactly like
    // generated ones — no lesson_type/student so it shows via the regular class path.
    const payload = isClass ? {
      class_id:    Number(f.class_id),
      lesson_date: f.lesson_date,
      start_time:  f.start_time,
      end_time:    f.end_time || null,
      room:        f.room?.trim() || null,
      notes:       f.notes?.trim() || null,
      status:      'scheduled',
    } : {
      lesson_type:          f.lesson_type || 'one_on_one',
      level_test_build_ids: isLevelTest ? (f.level_test_build_ids.length ? f.level_test_build_ids : null) : null,
      level_test_build_id:  isLevelTest ? (f.level_test_build_ids[0] || null) : null,
      lesson_date:          f.lesson_date,
      start_time:           f.start_time,
      end_time:             f.end_time || null,
      student_name:         f.student_name.trim() || null,
      scheduled_teacher_id: isLevelTest ? null : (f.teacher_id || null),
      is_makeup:            false,
      room:                 f.room?.trim() || null,
      notes:                f.notes?.trim() || null,
      status:               'scheduled',
    }
    const { data, error } = await supabase.from(T_LESSONS).insert(payload).select().single()
    if (error) { alert(`Add lesson failed: ${error.message}`); setAddLessonSaving(false); return }
    if (isClass) {
      // Reload so the class label (and week) is recomputed for the new row.
      if (selectedTable === 'lessons') setReloadKey(k => k + 1)
    } else {
      const teacherName = isLevelTest ? null : (allStaffForLessons.find(s => s.id === f.teacher_id)?.full_name ?? null)
      const enriched = { ...data, [LESSON_SCHED_TEACHER_COL]: teacherName }
      if (selectedTable === 'lessons') {
        setRows(prev => [enriched, ...prev])
        if (columns.length === 0) setColumns(Object.keys(enriched))
      }
    }
    setRowCounts(prev => ({ ...prev, lessons: (prev.lessons ?? 0) + 1 }))
    pushUndo({ type: 'add_row', table: 'lessons', realTable: T_LESSONS, pkCol: 'id', rowId: data.id })
    setAddLessonSaving(false)
    setShowAddLessonModal(false)
    // A level test opens straight into its marking page.
    if (f.lesson_type === 'level_test') router.push(`/tutor/lessons/${data.id}`)
  }

  // Delete a level-test lesson (its marks cascade via the FK).
  const handleDeleteLevelTest = async (lessonId) => {
    const prevRows = rows
    setRows(prev => prev.filter(r => r.id !== lessonId))
    const { error } = await supabase.from(T_LESSONS).delete().eq('id', lessonId)
    if (error) { alert(`Delete failed: ${error.message}`); setRows(prevRows); return }
    setRowCounts(prev => ({ ...prev, lessons: Math.max(0, (prev.lessons ?? 1) - 1) }))
  }

  // ── Add Course modal ──────────────────────────────────────────────────────────
  // The form shows every editable course column (from tableMeta), so adding a
  // course is a guided form rather than an inline blank row.
  const courseFormCols = Object.entries(TABLE_META[T_COURSES]?.columns ?? {})
    .filter(([, m]) => !m.readOnly && !m.hidden)
  const courseFormValid = courseFormCols.every(([col, m]) => !m.required || String(newCourseForm[col] ?? '').trim() !== '')

  const openAddCourseModal = () => {
    setNewCourseForm({ delivery_mode: 'Class' })   // sensible default for the dropdown
    setShowAddCourseModal(true)
    setDeleteConfirm(null)
  }

  const handleAddCourse = async () => {
    if (!courseFormValid) return
    setAddCourseSaving(true)
    const payload = {}
    for (const [col] of courseFormCols) {
      const v = newCourseForm[col]
      payload[col] = (v === undefined || String(v).trim() === '') ? null : (typeof v === 'string' ? v.trim() : v)
    }
    const { data, error } = await supabase.from(T_COURSES).insert(payload).select().single()
    if (error) { alert(`Add course failed: ${error.message}`); setAddCourseSaving(false); return }
    if (selectedTable === T_COURSES) {
      setRows(prev => [data, ...prev])
      if (columns.length === 0) setColumns(Object.keys(data))
    }
    setRowCounts(prev => ({ ...prev, [T_COURSES]: (prev[T_COURSES] ?? 0) + 1 }))
    pushUndo({ type: 'add_row', table: T_COURSES, realTable: T_COURSES, pkCol: 'id', rowId: data.id })
    setAddCourseSaving(false)
    setShowAddCourseModal(false)
    setNewCourseForm({})
  }

  // ── Lessons: load class list + all staff when entering lessons table ──────────
  useEffect(() => {
    if (selectedTable !== 'lessons') return
    ;(async () => {
      if (allClassesForFilter.length === 0) {
        const { data } = await supabase
          .from(T_CLASSES).select('id, class_name, day_of_week').order('class_name')
        const filterLabelMap = buildClassLabelMap(data || [])
        setAllClassesForFilter((data || []).map(c => ({ ...c, class_name: filterLabelMap.get(c.id) ?? c.class_name })))
      }
      if (allStaffForLessons.length === 0) {
        const [{ data: tutors }, { data: directors }] = await Promise.all([
          supabase.from(T_TUTORS).select('id, full_name').eq('active', true).order('full_name'),
          supabase.from(T_ADMINS).select('id, full_name').order('full_name'),
        ])
        const combined = [
          ...(tutors || []).map(t => ({ ...t, role: 'tutor' })),
          ...(directors || []).map(d => ({ ...d, role: 'admin' })),
        ].sort((a, b) => a.full_name.localeCompare(b.full_name))
        setAllStaffForLessons(combined)
      }
    })()
  }, [selectedTable])

  // Once staff loads, back-fill the scheduled_teacher display name in already-loaded lesson rows
  useEffect(() => {
    if (selectedTable !== 'lessons' || allStaffForLessons.length === 0) return
    const staffById = Object.fromEntries(allStaffForLessons.map(s => [s.id, s.full_name]))
    setRows(prev => prev.map(row => ({
      ...row,
      [LESSON_SCHED_TEACHER_COL]: row.scheduled_teacher_id
        ? (staffById[row.scheduled_teacher_id] ?? row.scheduled_teacher_id)
        : null,
    })))
  }, [allStaffForLessons, selectedTable])

  const handleGenerateLessons = async () => {
    if (!lessonClassFilter) return
    setGeneratingLessons(true)
    await supabase.rpc('generate_lessons_for_class', { p_class_id: Number(lessonClassFilter) })
    setReloadKey(k => k + 1)
    setGeneratingLessons(false)
  }

  // ── Delete row ───────────────────────────────────────────────────────────────
  const handleDeleteRow = async (rowId) => {
    if (!pkCol) return
    const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
    const rowData   = rows.find(r => r[pkCol] === rowId)
    const { error } = await supabase.from(realTable).delete().eq(pkCol, rowId)
    if (error) { alert(`Delete failed: ${error.message}`); return }
    setRows(prev => prev.filter(r => r[pkCol] !== rowId))
    setRowCounts(prev => ({ ...prev, [selectedTable]: Math.max(0, (prev[selectedTable] ?? 1) - 1) }))
    setDeleteConfirm(null)
    if (rowData) pushUndo({ type:'delete_row', table: selectedTable, realTable, pkCol, rowData })
  }

  // ── Enrolment: add student to class ─────────────────────────────────────────
  const handleEnrol = async (classId, studentId) => {
    setEnrolSaving(true)
    const { error } = await supabase.from(T_ENROLMENTS).insert({ class_id: classId, student_id: studentId })
    if (!error) {
      const student = allStudentsList.find(s => s.id === studentId)
      if (student) {
        setEnrolmentMap(prev => {
          const list = [...(prev[classId] || []), student].sort((a, b) => a.full_name.localeCompare(b.full_name))
          return { ...prev, [classId]: list }
        })
      }
      setRowCounts(prev => ({ ...prev, enrolments: (prev.enrolments ?? 0) + 1 }))
    } else {
      alert('Enrolment failed: ' + error.message)
    }
    setEnrolSaving(false)
    setEnrolPopover(null)
  }

  // ── Enrolment: remove student from class ─────────────────────────────────────
  const handleUnenrol = async (classId, studentId) => {
    const { error } = await supabase.from(T_ENROLMENTS).delete().eq('class_id', classId).eq('student_id', studentId)
    if (!error) {
      setEnrolmentMap(prev => ({ ...prev, [classId]: (prev[classId] || []).filter(s => s.id !== studentId) }))
      setRowCounts(prev => ({ ...prev, enrolments: Math.max(0, (prev.enrolments ?? 1) - 1) }))
    } else {
      alert('Unenrolment failed: ' + error.message)
    }
  }

  // ── Invoice card data ────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedTable !== T_INVOICES || invoiceViewMode !== 'cards' || !invoiceTermId) return
    ;(async () => {
      setLoadingCards(true)

      // 1. Invoices for this term
      const { data: invoices } = await supabase.from(T_INVOICES).select('*').eq('term_id', invoiceTermId).order('id')
      if (!invoices?.length) { setInvoiceCardsData([]); setLoadingCards(false); return }

      // 2. Term name + dates
      const { data: termRow } = await supabase.from(T_TERMS).select('id, name, start_date, end_date').eq('id', invoiceTermId).single()
      const termName      = termRow?.name ?? ''
      const termStartDate = termRow?.start_date ?? null
      const termEndDate   = termRow?.end_date   ?? null

      // 3. Students
      const familyIds    = [...new Set(invoices.filter(i => i.family_id != null).map(i => i.family_id))]
      const soloStudentIds = invoices.filter(i => i.student_id != null).map(i => i.student_id)
      const [famRes, soloRes] = await Promise.all([
        familyIds.length    ? supabase.from(T_STUDENTS).select('id, full_name, family_id').in('family_id', familyIds)    : { data: [] },
        soloStudentIds.length ? supabase.from(T_STUDENTS).select('id, full_name').in('id', soloStudentIds) : { data: [] },
      ])
      const allStudents = [...(famRes.data || []), ...(soloRes.data || [])]
      const allStudentIds = allStudents.map(s => s.id)

      // 4. Classes for this term (with course name) + full class list for labels
      const [{ data: termClasses }, { data: allClassesForLabels }] = await Promise.all([
        supabase.from(T_CLASSES).select('id, class_name, courses(course_name)').eq('term_id', invoiceTermId),
        supabase.from(T_CLASSES).select('id, class_name'),
      ])
      const invoiceClassLabelMap = buildClassLabelMap(allClassesForLabels || [])
      const classMap = Object.fromEntries((termClasses || []).map(c => [c.id, c]))
      const termClassIds = (termClasses || []).map(c => c.id)

      // 5. Enrolments (include created_at so we can hide post-invoice enrolments on paid cards)
      let enrolments = []
      if (allStudentIds.length && termClassIds.length) {
        const { data } = await supabase.from(T_ENROLMENTS).select('student_id, class_id, price, created_at').in('student_id', allStudentIds).in('class_id', termClassIds)
        enrolments = data || []
      }

      // 6. Credits already applied to these invoices
      const invoiceIds = invoices.map(i => i.id)
      const { data: creditRows } = await supabase
        .from(T_STUDENT_CREDITS).select('*').in('invoice_id', invoiceIds)
      const creditsByInvoice = {}
      for (const c of creditRows || []) {
        if (!creditsByInvoice[c.invoice_id]) creditsByInvoice[c.invoice_id] = []
        creditsByInvoice[c.invoice_id].push(c)
      }

      // 7. Pending credits for all students on these invoices (not yet linked to an invoice)
      const { data: pendingRows } = allStudentIds.length
        ? await supabase.from(T_STUDENT_CREDITS).select('*').in('student_id', allStudentIds).is('invoice_id', null)
        : { data: [] }
      const pendingByStudent = {}
      for (const c of pendingRows || []) {
        if (!pendingByStudent[c.student_id]) pendingByStudent[c.student_id] = []
        pendingByStudent[c.student_id].push(c)
      }

      // 8. Build enriched cards
      const cards = invoices.map(inv => {
        const members = inv.family_id != null
          ? allStudents.filter(s => s.family_id === inv.family_id)
          : allStudents.filter(s => s.id === inv.student_id)

        // For paid invoices with a generated_at stamp, only show enrolments that existed at generation time
        const genCutoff = inv.generated_at ? new Date(inv.generated_at) : null
        const membersWithEnrols = members.map(s => ({
          ...s,
          enrolments: enrolments
            .filter(e => e.student_id === s.id && (!genCutoff || new Date(e.created_at) <= genCutoff))
            .map(e => ({ label: invoiceClassLabelMap.get(e.class_id) || classMap[e.class_id]?.courses?.course_name || classMap[e.class_id]?.class_name || '—', price: e.price, classId: e.class_id })),
        }))

        const sharedLast  = members[0]?.full_name?.split(' ').pop() ?? ''
        const getFirst    = name => name?.split(' ').slice(0, -1).join(' ') || name || ''
        const firstNames  = members.map(m => getFirst(m.full_name))
        const joinedFirst = firstNames.length <= 1
          ? firstNames[0] ?? ''
          : `${firstNames.slice(0, -1).join(', ')} & ${firstNames[firstNames.length - 1]}`
        const familyDisplay = `${joinedFirst} ${sharedLast}`.trim()

        const credits = creditsByInvoice[inv.id] || []
        const creditsTotal = credits.reduce((s, c) => s + Number(c.amount), 0)
        const memberIds = members.map(m => m.id)
        const pendingCredits = memberIds.flatMap(id => pendingByStudent[id] || [])
        const pendingTotal = pendingCredits.reduce((s, c) => s + Number(c.amount), 0)

        return {
          ...inv,
          termName,
          termStartDate,
          termEndDate,
          displayName: inv.family_id != null ? familyDisplay : (members[0]?.full_name ?? 'Unknown'),
          isFamily: inv.family_id != null,
          members: membersWithEnrols,
          credits,
          creditsTotal,
          pendingCredits,
          pendingTotal,
          adjustedTotal: Number(inv.total),
        }
      })

      setInvoiceCardsData(cards)
      setLoadingCards(false)
    })()
  }, [selectedTable, invoiceViewMode, invoiceTermId, reloadKey])

  // ── Student directory card data ──────────────────────────────────────────────
  useEffect(() => {
    if (selectedTable !== T_STUDENTS || studentViewMode !== 'cards') return
    ;(async () => {
      setLoadingStudentCards(true)
      const [{ data: students }, { data: enrolments }, { data: parents }] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, email, school, year, gender, phone, status').order('full_name'),
        supabase.from(T_ENROLMENTS).select('student_id'),
        supabase.from(T_PARENTS).select('*'),
      ])
      const enrolMap = {}
      for (const e of enrolments || []) enrolMap[e.student_id] = (enrolMap[e.student_id] || 0) + 1
      const parentMap = {}
      for (const p of parents || []) parentMap[p.student_id] = p
      setStudentCardsData(students || [])
      setStudentCardsEnrolments(enrolMap)
      setStudentCardsParents(parentMap)
      setLoadingStudentCards(false)
    })()
  }, [selectedTable, studentViewMode, reloadKey])

  // ── Drop-in session data ─────────────────────────────────────────────────────
  const DROPIN_SUBJECTS = ['Maths', 'English', 'Chemistry', 'Biology', 'Physics', 'Economics']

  const loadDropinSessions = useCallback(async () => {
    setLoadingDropin(true)
    const [{ data: sessions }, { data: signins }, { data: students }] = await Promise.all([
      supabase.from(T_DROPIN_SESSIONS).select('*').order('session_date', { ascending: false }).order('start_time'),
      supabase.from(T_DROPIN_SIGNINS).select('*').order('signed_in_at'),
      supabase.from(T_STUDENTS).select('id, full_name').order('full_name'),
    ])
    const signinMap = {}
    for (const s of signins || []) {
      if (!signinMap[s.session_id]) signinMap[s.session_id] = []
      signinMap[s.session_id].push(s)
    }
    setDropinSessions((sessions || []).map(s => ({ ...s, signins: signinMap[s.id] || [] })))
    setDropinStudents(students || [])
    setLoadingDropin(false)
  }, [])

  useEffect(() => {
    if (selectedTable !== T_DROPIN_SESSIONS || dropinViewMode !== 'sessions') return
    loadDropinSessions()
  }, [selectedTable, dropinViewMode, reloadKey, loadDropinSessions])

  const handleDeleteSession = async (id) => {
    await supabase.from(T_DROPIN_SIGNINS).delete().eq('session_id', id)
    await supabase.from(T_DROPIN_SESSIONS).delete().eq('id', id)
    setDropinSessions(s => s.filter(x => x.id !== id))
    setDeleteSessionId(null)
  }

  const handleRemoveSignin = async (sessionId, signinId) => {
    await supabase.from(T_DROPIN_SIGNINS).delete().eq('id', signinId)
    setDropinSessions(s => s.map(x => x.id !== sessionId ? x : { ...x, signins: x.signins.filter(si => si.id !== signinId) }))
  }

  // ── Lesson sidebar ────────────────────────────────────────────────────────────
  const openLessonSidebar = useCallback(async (lesson) => {
    setLessonSidebar(lesson)
    setMakeupStudent(null); setMakeupMode(null); setMoveOptions([]); setMoveTargetId(null)
    setOneToOneTutorId(''); setOneToOneDate(''); setOneToOneStart(''); setOneToOneEnd(''); setOneToOneRoom('')
    setSidebarLoading(true); setSidebarData(null)

    // Fetch enrolments, attendance, and tutors in parallel
    const [{ data: enrolRows }, { data: attRows }, { data: tutorRows }, { data: directorRows }] = await Promise.all([
      supabase.from(T_ENROLMENTS).select('student_id, students(id, full_name, year, school)').eq('class_id', lesson.class_id),
      supabase.from(T_ATTENDANCE).select('student_id, status, notes').eq('class_id', lesson.class_id).eq('session_date', lesson.lesson_date),
      supabase.from(T_TUTORS).select('id, full_name').order('full_name'),
      supabase.from(T_ADMINS).select('id, full_name').order('full_name'),
    ])
    const roster = (enrolRows || []).map(e => e.students).filter(Boolean)
    const attMap = {}
    for (const a of attRows || []) attMap[a.student_id] = a

    // Also surface makeup-moved guests: students with an attendance record here
    // but not enrolled in this class (e.g. moved from a sibling section).
    const enrolledIds = new Set(roster.map(s => s.id))
    const guestIds = Object.keys(attMap).filter(id => !enrolledIds.has(id))
    if (guestIds.length > 0) {
      const { data: guestStudents } = await supabase
        .from(T_STUDENTS)
        .select('id, full_name, year, school')
        .in('id', guestIds)
      for (const s of guestStudents || []) {
        roster.push({ ...s, isMakeupGuest: true })
      }
    }

    roster.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    const allTutors = [...(tutorRows || []), ...(directorRows || [])].sort((a, b) => a.full_name.localeCompare(b.full_name))
    setSidebarData({ roster, attMap, tutors: allTutors })
    setSidebarLoading(false)
  }, [])

  const closeLessonSidebar = useCallback(() => {
    setLessonSidebar(null); setSidebarData(null)
    setMakeupStudent(null); setMakeupMode(null)
    setCancelType('credit'); setCancelReason(''); setCancelCredit(null)
  }, [])

  const openCancelFlow = useCallback(async (student, lesson) => {
    setMakeupMode('cancel')
    setCancelType('credit'); setCancelReason(''); setCancelCredit(null)
    // Fetch enrolment price for credit preview
    const { data: e } = await supabase
      .from('enrolments')
      .select('price')
      .eq('student_id', student.id)
      .eq('class_id', lesson.class_id)
      .maybeSingle()
    if (e?.price) {
      const amt = Math.round((Number(e.price) / 10) * 100) / 100
      setCancelCredit({ amount: amt, enrolment_price: e.price })
    }
  }, [])

  const handleCancelLesson = useCallback(async () => {
    if (!makeupStudent || !lessonSidebar) return
    setMakeupSaving(true)
    try {
      const res = await authedFetch('/api/cancel-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lesson_id:  lessonSidebar.id,
          student_id: makeupStudent.id,
          type:       cancelType,
          reason:     cancelReason || null,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      // Refresh sidebar data
      setSidebarData(prev => prev ? {
        ...prev,
        attMap: { ...prev.attMap, [makeupStudent.id]: { status: 'cancelled' } },
      } : prev)
      setMakeupStudent(null); setMakeupMode(null)
      setCancelReason(''); setCancelCredit(null)
      setReloadKey(k => k + 1)
    } catch (e) {
      alert('Cancel failed: ' + e.message)
    } finally {
      setMakeupSaving(false)
    }
  }, [makeupStudent, lessonSidebar, cancelType, cancelReason])

  const openMakeupMove = useCallback(async (lesson) => {
    setMakeupMode('move'); setMoveLoadingOpts(true); setMoveOptions([]); setMoveTargetId(null)
    // 1. Look up course_id for this lesson's class
    const { data: classRow } = await supabase
      .from(T_CLASSES)
      .select('course_id')
      .eq('id', lesson.class_id)
      .single()
    // 2. Find all sibling class IDs in the same course
    let siblingClassIds = [lesson.class_id]
    if (classRow?.course_id) {
      const { data: siblings } = await supabase
        .from(T_CLASSES)
        .select('id')
        .eq('course_id', classRow.course_id)
      if (siblings?.length) siblingClassIds = siblings.map(s => s.id)
    }
    // 3. Date window: full Mon–Sun week containing the lesson date
    const lessonDate = new Date(lesson.lesson_date + 'T00:00:00')
    const dow = lessonDate.getDay() // 0=Sun
    const monday = new Date(lessonDate); monday.setDate(lessonDate.getDate() - ((dow + 6) % 7))
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const weekStart = monday.toISOString().slice(0, 10)
    const weekEnd   = sunday.toISOString().slice(0, 10)
    // 4. Fetch all lessons in that week across all sibling classes, excluding this lesson
    const { data: opts } = await supabase
      .from(T_LESSONS)
      .select('id, lesson_date, start_time, end_time, class_id, classes(class_name, room)')
      .in('class_id', siblingClassIds)
      .gte('lesson_date', weekStart)
      .lte('lesson_date', weekEnd)
      .neq('id', lesson.id)
      .order('lesson_date')
      .order('start_time')
    setMoveOptions(opts || [])
    setMoveLoadingOpts(false)
  }, [])

  const saveMakeupMove = useCallback(async () => {
    if (!moveTargetId || !makeupStudent || !lessonSidebar) return
    setMakeupSaving(true)

    const target = moveOptions.find(o => o.id === moveTargetId)
    if (!target) { setMakeupSaving(false); return }

    // ── Guard: don't "move" a student into a session they already attend ──
    // If the student is an enrolled member of the target session's class, they
    // already attend it — moving them there is redundant and double-books them.
    // A move is only valid into a sibling section they are NOT enrolled in.
    {
      const { data: enr } = await supabase
        .from(T_ENROLMENTS)
        .select('id')
        .eq('student_id', makeupStudent.id)
        .eq('class_id', target.class_id)
        .in('status', ['active', 'trial'])
        .maybeSingle()
      if (enr) {
        alert(`${makeupStudent.full_name} is already enrolled in ${target.classes?.class_name || 'that class'}, so they already attend that session — a makeup move would double-book them.\n\nIf they aren't attending the original session, use "Cancel this lesson" instead to mark it as absent and apply a credit.`)
        setMakeupSaving(false)
        return
      }
    }

    // 1. Mark student as 'makeup' on the original lesson
    const { error: err1 } = await supabase.from(T_ATTENDANCE).upsert({
      student_id: makeupStudent.id, class_id: lessonSidebar.class_id,
      session_date: lessonSidebar.lesson_date, status: 'makeup',
    }, { onConflict: 'student_id,class_id,session_date' })
    if (err1) { alert('Failed to update original attendance: ' + err1.message); setMakeupSaving(false); return }

    // 2. Mark student as 'present' on the target lesson (makeup guest)
    const { error: err2 } = await supabase.from(T_ATTENDANCE).upsert({
      student_id: makeupStudent.id, class_id: target.class_id,
      session_date: target.lesson_date, status: 'present',
      notes: `Makeup from ${lessonSidebar.lesson_date}`,
    }, { onConflict: 'student_id,class_id,session_date' })
    if (err2) { alert('Failed to update target attendance: ' + err2.message); setMakeupSaving(false); return }

    // 3. Create a makeup lesson row on the target so the student appears in the
    //    lessons table and the tutor's weekly calendar (skip if already exists)
    const { data: existingMakeup } = await supabase
      .from(T_LESSONS).select('id').eq('is_makeup', true)
      .eq('makeup_student_id', makeupStudent.id)
      .eq('class_id', target.class_id).eq('lesson_date', target.lesson_date)
      .maybeSingle()
    if (!existingMakeup) {
      const { error: err3 } = await supabase.from(T_LESSONS).insert({
        class_id: target.class_id,
        lesson_date: target.lesson_date,
        start_time: target.start_time,
        end_time: target.end_time,
        room: target.classes?.room || null,
        status: 'scheduled',
        week: target.week ?? null,
        is_makeup: true,
        makeup_student_id: makeupStudent.id,
        makeup_source_lesson_id: lessonSidebar.id,
      })
      if (err3) { alert('Failed to create makeup lesson row: ' + err3.message); setMakeupSaving(false); return }
    }

    // 4. Refresh the sidebar for the SOURCE lesson (student now shows 'Makeup')
    const { data: attRows } = await supabase
      .from(T_ATTENDANCE).select('student_id, status, notes')
      .eq('class_id', lessonSidebar.class_id).eq('session_date', lessonSidebar.lesson_date)
    const attMap = {}
    for (const a of attRows || []) attMap[a.student_id] = a
    // Rebuild roster with guest detection (unchanged enrolled students + any guests)
    const { data: enrolRows } = await supabase
      .from(T_ENROLMENTS).select('student_id, students(id, full_name, year, school)')
      .eq('class_id', lessonSidebar.class_id)
    const roster = (enrolRows || []).map(e => e.students).filter(Boolean)
    const enrolledIds = new Set(roster.map(s => s.id))
    const guestIds = Object.keys(attMap).filter(id => !enrolledIds.has(id))
    if (guestIds.length > 0) {
      const { data: guestStudents } = await supabase
        .from(T_STUDENTS).select('id, full_name, year, school').in('id', guestIds)
      for (const s of guestStudents || []) roster.push({ ...s, isMakeupGuest: true })
    }
    roster.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    setSidebarData(d => ({ ...d, attMap, roster }))

    setMakeupSaving(false); setMakeupMode(null); setMakeupStudent(null)
    setReloadKey(k => k + 1)  // refresh lessons table to show new makeup row
  }, [moveTargetId, makeupStudent, lessonSidebar, moveOptions])

  const saveMakeupOneToOne = useCallback(async () => {
    if (!makeupStudent || !lessonSidebar || !oneToOneDate) return
    setMakeupSaving(true)

    // ── Guard: don't create a makeup into a session the student already attends ──
    // A makeup only makes sense when the student is MISSING a class and needs to
    // catch it elsewhere. If they're an enrolled member of this class and it
    // already runs on the chosen date, a makeup would just double-book them
    // (this is exactly what produced the bogus Emily/Emma rows). In that case
    // the correct action is "Cancel this lesson" (absence + credit), not a makeup.
    {
      const { data: clashLesson } = await supabase
        .from(T_LESSONS)
        .select('id')
        .eq('class_id', lessonSidebar.class_id)
        .eq('lesson_date', oneToOneDate)
        .eq('is_makeup', false)
        .limit(1)
        .maybeSingle()
      if (clashLesson) {
        const { data: enr } = await supabase
          .from(T_ENROLMENTS)
          .select('id')
          .eq('student_id', makeupStudent.id)
          .eq('class_id', lessonSidebar.class_id)
          .in('status', ['active', 'trial'])
          .maybeSingle()
        if (enr) {
          alert(`${makeupStudent.full_name} is already enrolled in this class and it runs on ${oneToOneDate}, so a makeup isn't needed — it would double-book them.\n\nIf they aren't attending the original session, use "Cancel this lesson" instead to mark it as absent and apply a credit.`)
          setMakeupSaving(false)
          return
        }
      }
    }

    // Look up week number from an existing lesson on the same date
    const { data: weekRef } = await supabase
      .from(T_LESSONS)
      .select('week')
      .eq('lesson_date', oneToOneDate)
      .eq('is_makeup', false)
      .not('week', 'is', null)
      .limit(1)
      .maybeSingle()
    const resolvedWeek = weekRef?.week ?? null
    // Create new makeup lesson row
    const { error } = await supabase.from(T_LESSONS).insert({
      class_id: lessonSidebar.class_id,
      lesson_date: oneToOneDate,
      start_time: oneToOneStart || null,
      end_time: oneToOneEnd || null,
      room: oneToOneRoom || null,
      status: 'scheduled',
      week: resolvedWeek,
      scheduled_teacher_id: oneToOneTutorId || null,
      is_makeup: true,
      makeup_student_id: makeupStudent.id,
      makeup_source_lesson_id: lessonSidebar.id,
    })
    if (error) { alert('Failed to create makeup lesson: ' + error.message); setMakeupSaving(false); return }
    // Mark original lesson attendance as makeup
    const { error: attErr } = await supabase.from(T_ATTENDANCE).upsert({
      student_id: makeupStudent.id, class_id: lessonSidebar.class_id,
      session_date: lessonSidebar.lesson_date, status: 'makeup',
      notes: `1:1 makeup scheduled for ${oneToOneDate}`,
    }, { onConflict: 'student_id,class_id,session_date' })
    if (attErr) { alert('Lesson created but failed to update attendance: ' + attErr.message); setMakeupSaving(false); return }
    // Refresh attendance
    const { data: attRows } = await supabase.from(T_ATTENDANCE).select('student_id, status, notes').eq('class_id', lessonSidebar.class_id).eq('session_date', lessonSidebar.lesson_date)
    const attMap = {}; for (const a of attRows || []) attMap[a.student_id] = a
    setSidebarData(d => ({ ...d, attMap }))
    setMakeupSaving(false); setMakeupMode(null); setMakeupStudent(null)
    setReloadKey(k => k + 1)  // refresh lessons table
  }, [makeupStudent, lessonSidebar, oneToOneDate, oneToOneStart, oneToOneEnd, oneToOneRoom, oneToOneTutorId])

  // ── Credit & referral handlers ────────────────────────────────────────────────
  const CREDIT_REASON_LABELS = {
    missed_lesson:       'Missed lesson',
    late_start:          'Late start',
    referral_referring:  'Referral (referring)',
    referral_referred:   'Referral (referred)',
    other:               'Other',
  }

  const handleAddCredit = async ({ invoiceId, studentId, amount, reason, notes }) => {
    const { error } = await supabase.from(T_STUDENT_CREDITS).insert({
      student_id: studentId,
      amount: Number(amount),
      reason,
      notes: notes.trim() || null,
      invoice_id: invoiceId,
      created_by: staff?.id,
    })
    if (error) { alert('Failed to add credit: ' + error.message); return }
    // Reduce the invoice total
    const inv = invoiceCardsData.find(i => i.id === invoiceId)
    if (inv) {
      const newTotal = Math.max(0, Number(inv.total) - Number(amount))
      await supabase.from(T_INVOICES).update({ total: newTotal }).eq('id', invoiceId)
    }
    setCreditModal(null)
    setReloadKey(k => k + 1)
  }

  const handleApplyPending = async (inv) => {
    if (!inv.pendingCredits?.length) return
    for (const credit of inv.pendingCredits) {
      await supabase.from(T_STUDENT_CREDITS).update({ invoice_id: inv.id }).eq('id', credit.id)
    }
    const newTotal = Math.max(0, Number(inv.total) - inv.pendingTotal)
    await supabase.from(T_INVOICES).update({ total: newTotal }).eq('id', inv.id)
    setReloadKey(k => k + 1)
  }

  const handleLogReferral = async ({ referringStudentId, referredStudentId }) => {
    if (!referringStudentId || !referredStudentId || referringStudentId === referredStudentId) {
      alert('Please select two different students.'); return
    }
    // Insert referral record
    const { error: refErr } = await supabase.from(T_REFERRALS).insert({
      referring_student_id: referringStudentId,
      referred_student_id:  referredStudentId,
      created_by: staff?.id,
    })
    if (refErr) { alert('Failed to log referral: ' + refErr.message); return }

    // Immediate $50 credit for referred student → apply to their current draft/unpaid invoice if one exists
    const { data: referredInv } = await supabase.from(T_INVOICES)
      .select('id, total').eq('student_id', referredStudentId).neq('status', 'paid').order('id', { ascending: false }).limit(1).maybeSingle()

    await supabase.from(T_STUDENT_CREDITS).insert({
      student_id: referredStudentId,
      amount: 50,
      reason: 'referral_referred',
      notes: 'Referral discount — welcome credit',
      invoice_id: referredInv?.id ?? null,
      created_by: staff?.id,
    })
    if (referredInv) {
      await supabase.from(T_INVOICES).update({ total: Math.max(0, Number(referredInv.total) - 50) }).eq('id', referredInv.id)
    }

    // Pending $50 credit for referring student → no invoice_id (applied to NEXT invoice)
    await supabase.from(T_STUDENT_CREDITS).insert({
      student_id: referringStudentId,
      amount: 50,
      reason: 'referral_referring',
      notes: 'Referral reward — $50 off next invoice',
      invoice_id: null,
      created_by: staff?.id,
    })

    setReferralModal(false)
    setReloadKey(k => k + 1)
    alert('Referral logged! $50 applied to referred student\'s invoice. $50 credit pending for referring student\'s next invoice.')
  }

  const handleInvoiceStatusUpdate = async (invoiceId, newStatus) => {
    const prev = invoiceCardsData
    setInvoiceCardsData(d => d.map(c => c.id === invoiceId ? { ...c, status: newStatus } : c))
    const { error } = await supabase.from(T_INVOICES).update({ status: newStatus }).eq('id', invoiceId)
    if (error) { alert('Update failed: ' + error.message); setInvoiceCardsData(prev) }
    // Also update raw rows so data view stays in sync
    setRows(r => r.map(row => row.id === invoiceId ? { ...row, status: newStatus } : row))
  }

  // ── Sticky columns (students table: # row-num, id, full_name) ───────────────
  // Builds a map of col → left offset in px so those columns stay pinned while
  // the table scrolls horizontally. Only active for the students table.
  const stickyColOffsets = useMemo(() => {
    if (selectedTable !== 'students') return {}
    const STICKY = new Set(['id', 'full_name'])
    const offsets = {}
    let left = 42 // the always-visible # row-number column is 42 px wide
    for (const col of columnOrder) {
      if (STICKY.has(col)) offsets[col] = left
      left += columnWidths[col] ?? defaultWidth(col)
    }
    return offsets
  }, [selectedTable, columnOrder, columnWidths])

  // ── Sibling management ───────────────────────────────────────────────────────
  // Derive a sibling map from allStudentsForSiblings: { studentId → [sibling, ...] }
  const siblingMap = useMemo(() => {
    const map = {}
    const byFamily = {}
    for (const s of allStudentsForSiblings) {
      if (s.family_id != null) {
        if (!byFamily[s.family_id]) byFamily[s.family_id] = []
        byFamily[s.family_id].push(s)
      }
    }
    for (const s of allStudentsForSiblings) {
      if (s.family_id != null) {
        map[s.id] = byFamily[s.family_id].filter(x => x.id !== s.id)
      } else {
        map[s.id] = []
      }
    }
    return map
  }, [allStudentsForSiblings])

  const handleAddSibling = async (studentId, siblingId) => {
    setSiblingSaving(true)
    const student = allStudentsForSiblings.find(s => s.id === studentId)
    const sibling = allStudentsForSiblings.find(s => s.id === siblingId)
    if (!student || !sibling) { setSiblingSaving(false); return }

    let familyId = student.family_id ?? sibling.family_id

    if (familyId == null) {
      // Neither has a family yet — generate a new family_id
      const maxId = allStudentsForSiblings.reduce((m, s) => Math.max(m, s.family_id ?? 0), 0)
      familyId = maxId + 1
    }

    // If one already has a family_id, merge the other's family into it
    const oldFamilyId = student.family_id != null && sibling.family_id != null && student.family_id !== sibling.family_id
      ? sibling.family_id : null

    const idsToUpdate = [studentId, siblingId]
    if (oldFamilyId != null) {
      // Also reassign all other members of the old family
      allStudentsForSiblings.filter(s => s.family_id === oldFamilyId).forEach(s => idsToUpdate.push(s.id))
    }
    const uniqueIds = [...new Set(idsToUpdate)]

    await supabase.from(T_STUDENTS).update({ family_id: familyId }).in('id', uniqueIds)

    // Update local state
    setAllStudentsForSiblings(prev => prev.map(s =>
      uniqueIds.includes(s.id) ? { ...s, family_id: familyId } : s
    ))
    // Also update rows so family_id cell reflects new value
    setRows(prev => prev.map(r =>
      uniqueIds.includes(r.id) ? { ...r, family_id: familyId } : r
    ))
    setSiblingSaving(false)
    setSiblingPopover(null)
  }

  const handleRemoveSibling = async (studentId) => {
    // Remove this student from their family (set family_id to null)
    await supabase.from(T_STUDENTS).update({ family_id: null }).eq('id', studentId)
    setAllStudentsForSiblings(prev => prev.map(s => s.id === studentId ? { ...s, family_id: null } : s))
    setRows(prev => prev.map(r => r.id === studentId ? { ...r, family_id: null } : r))
  }

  // ── Hide column (double-click header) ───────────────────────────────────────
  const hideCol = useCallback((col) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      next.add(col)
      saveHidden(selectedTable, next)
      return next
    })
  }, [selectedTable, saveHidden])

  const restoreCol = useCallback((col) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      next.delete(col)
      saveHidden(selectedTable, next)
      return next
    })
  }, [selectedTable, saveHidden])

  const restoreAllCols = useCallback(() => {
    setHiddenCols(new Set())
    saveHidden(selectedTable, new Set())
  }, [selectedTable, saveHidden])

  // ── Column context menu ──────────────────────────────────────────────────────
  const handleColContextMenu = (e, col) => {
    e.preventDefault()
    setEditingCell(null)
    setContextMenu({ x: e.clientX, y: e.clientY, col })
  }

  // ── Column rename ────────────────────────────────────────────────────────────
  const startColRename = (col) => {
    setContextMenu(null)
    setRenamingCol(col); setRenameColValue(col); setRenameColError(null); setEditingCell(null)
  }

  const commitColRename = async () => {
    const oldCol = renamingCol
    const newCol = renameColValue.trim()
    if (!newCol || newCol === oldCol) { setRenamingCol(null); return }
    if (!/^[a-z_][a-z0-9_]*$/.test(newCol)) { setRenameColError('Lowercase letters, numbers, underscores only'); return }
    setRenameColWorking(true); setRenameColError(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
      await execDDL(session.access_token, `ALTER TABLE public.${realTable} RENAME COLUMN ${oldCol} TO ${newCol};`)
      const rename    = (arr) => arr.map(c => c === oldCol ? newCol : c)
      const renameKey = (obj) => { if (!(oldCol in obj)) return obj; const n = {...obj}; n[newCol] = n[oldCol]; delete n[oldCol]; return n }
      setColumns(rename)
      setColumnOrder(prev => { const next = rename(prev); saveOrder(selectedTable, next); return next })
      setColumnWidths(prev => { const next = renameKey(prev); saveWidths(selectedTable, next); return next })
      setRows(prev => prev.map(r => renameKey(r)))
      pushUndo({ type:'rename_col', table: selectedTable, realTable, oldName: oldCol, newName: newCol })
      setRenamingCol(null)
    } catch (err) { setRenameColError(err.message) }
    finally { setRenameColWorking(false) }
  }

  const cancelColRename = () => { setRenamingCol(null); setRenameColError(null) }

  // ── Delete column ─────────────────────────────────────────────────────────
  const handleDropCol = (col) => {
    setContextMenu(null)
    const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
    setDropColInput('')
    setDropConfirmCol({ col, realTable, table: selectedTable })
  }

  const execDropCol = async () => {
    if (!dropConfirmCol) return
    const { col, realTable, table } = dropConfirmCol

    // Fetch column type for undo
    let colType = 'text'
    try {
      const { data } = await supabase.rpc('get_column_type', { p_table: realTable, p_column: col })
      if (data) colType = data
    } catch {}

    try {
      const { data:{ session } } = await supabase.auth.getSession()
      await execDDL(session.access_token, `ALTER TABLE public.${realTable} DROP COLUMN ${col} CASCADE;`)
      const remove    = (arr) => arr.filter(c => c !== col)
      const removeKey = (obj) => { const n = {...obj}; delete n[col]; return n }
      setColumns(remove)
      setColumnOrder(prev => { const next = remove(prev); saveOrder(table, next); return next })
      setColumnWidths(prev => { const next = removeKey(prev); saveWidths(table, next); return next })
      setRows(prev => prev.map(r => removeKey(r)))
      pushUndo({ type:'drop_col', table, realTable, col, colType })
      setDropConfirmCol(null)
    } catch (err) {
      alert(`Drop column failed: ${err.message}`)
    }
  }

  // ── Undo ──────────────────────────────────────────────────────────────────
  const handleUndo = async () => {
    if (undoStack.length === 0 || undoing) return
    const action = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setUndoing(true)
    try {
      const { data:{ session } } = await supabase.auth.getSession()

      if (action.type === 'rename_col') {
        await execDDL(session.access_token, `ALTER TABLE public.${action.realTable} RENAME COLUMN ${action.newName} TO ${action.oldName};`)
        if (selectedTable === action.table) {
          const revert    = (arr) => arr.map(c => c === action.newName ? action.oldName : c)
          const revertKey = (obj) => { if (!(action.newName in obj)) return obj; const n = {...obj}; n[action.oldName] = n[action.newName]; delete n[action.newName]; return n }
          setColumns(revert)
          setColumnOrder(prev => { const next = revert(prev); saveOrder(selectedTable, next); return next })
          setColumnWidths(prev => { const next = revertKey(prev); saveWidths(selectedTable, next); return next })
          setRows(prev => prev.map(r => revertKey(r)))
        }

      } else if (action.type === 'drop_col') {
        await execDDL(session.access_token, `ALTER TABLE public.${action.realTable} ADD COLUMN ${action.col} ${action.colType};`)
        // Reload to pick up the restored column
        if (selectedTable === action.table) setReloadKey(k => k + 1)

      } else if (action.type === 'rename_table') {
        await execDDL(session.access_token, `ALTER TABLE public.${action.newName} RENAME TO ${action.oldName};`)
        setTableGroups(prev => { const next = prev.map(g => ({ ...g, tables: g.tables.map(t => t === action.newName ? action.oldName : t) })); saveTableGroups(next); return next })
        setRowCounts(prev => { const n = {...prev}; if (action.newName in n) { n[action.oldName] = n[action.newName]; delete n[action.newName] } return n })
        if (selectedTable === action.newName) setSelectedTable(action.oldName)

      } else if (action.type === 'delete_row') {
        const { rowData } = action
        const { error } = await supabase.from(action.realTable).insert(rowData)
        if (error) throw error
        if (selectedTable === action.table) setReloadKey(k => k + 1)

      } else if (action.type === 'edit_cell') {
        const { error } = await supabase.from(action.realTable).update({ [action.col]: action.oldVal }).eq(action.pkCol, action.rowId)
        if (error) throw error
        if (selectedTable === action.table) {
          setRows(prev => prev.map(r => r[action.pkCol] === action.rowId ? { ...r, [action.col]: action.oldVal } : r))
        }

      } else if (action.type === 'add_row') {
        const { error } = await supabase.from(action.realTable).delete().eq(action.pkCol, action.rowId)
        if (error) throw error
        if (selectedTable === action.table) {
          setRows(prev => prev.filter(r => r[action.pkCol] !== action.rowId))
          setRowCounts(prev => ({ ...prev, [action.table]: Math.max(0, (prev[action.table] ?? 1) - 1) }))
        }
      }
    } catch (err) {
      alert(`Undo failed: ${err.message}`)
      setUndoStack(prev => [...prev, action])   // put it back
    } finally {
      setUndoing(false)
    }
  }

  // ── Table rename ─────────────────────────────────────────────────────────
  const startRename = (t) => { setRenamingTable(t); setRenameValue(t); setRenameError(null) }

  const commitRename = async () => {
    const oldName = renamingTable; const newName = renameValue.trim()
    if (!newName || newName === oldName) { setRenamingTable(null); return }
    if (!/^[a-z_][a-z0-9_]*$/.test(newName)) { setRenameError('Lowercase letters, numbers, underscores only'); return }
    setRenameWorking(true); setRenameError(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      await execDDL(session.access_token, `ALTER TABLE public.${oldName} RENAME TO ${newName};`)
      setTableGroups(prev => { const next = prev.map(g => ({ ...g, tables: g.tables.map(t => t === oldName ? newName : t) })); saveTableGroups(next); return next })
      setRowCounts(prev => { const n = {...prev}; if (oldName in n) { n[newName] = n[oldName]; delete n[oldName] } return n })
      if (selectedTable === oldName) setSelectedTable(newName)
      pushUndo({ type:'rename_table', oldName, newName })
      setRenamingTable(null)
    } catch (err) { setRenameError(err.message) }
    finally { setRenameWorking(false) }
  }

  const cancelRename = () => { setRenamingTable(null); setRenameError(null) }

  // ── Sidebar drag-to-reorder ─────────────────────────────────────────────────
  const handleSidebarDragStart = (e, tableName, groupLabel) => {
    dragRef.current = { table: tableName, groupLabel }
    setDragTable(tableName)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tableName)
  }
  const handleSidebarDragOver = (e, tableName, position) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragRef.current || dragRef.current.table === tableName) return
    setSidebarDragOver({ table: tableName, position })
  }
  const handleSidebarDrop = (e, targetTable, targetGroupLabel, position) => {
    e.preventDefault()
    const src = dragRef.current
    if (!src || src.table === targetTable) { setDragTable(null); setSidebarDragOver(null); return }

    setTableGroups(prev => {
      // Remove source from its group
      const next = prev.map(g => ({ ...g, tables: g.tables.filter(t => t !== src.table) }))
      // Insert into target group at target position
      const tgIdx = next.findIndex(g => g.label === targetGroupLabel)
      if (tgIdx === -1) { return prev }
      const tg = { ...next[tgIdx], tables: [...next[tgIdx].tables] }
      const insertIdx = tg.tables.indexOf(targetTable)
      if (insertIdx === -1) {
        tg.tables.push(src.table)
      } else {
        tg.tables.splice(position === 'after' ? insertIdx + 1 : insertIdx, 0, src.table)
      }
      next[tgIdx] = tg
      // Remove empty groups — but keep all original groups even if temporarily empty
      try { localStorage.setItem('cube_db_table_groups', JSON.stringify({ version: 'v6', groups: next })) } catch {}
      return next
    })
    setDragTable(null)
    setSidebarDragOver(null)
    dragRef.current = null
  }
  const handleSidebarDragEnd = () => {
    setDragTable(null)
    setSidebarDragOver(null)
    dragRef.current = null
  }

  // ── Table created ─────────────────────────────────────────────────────────
  const handleTableCreated = (name) => {
    setTableGroups(prev => {
      const idx = prev.findIndex(g => g.label === 'Custom')
      const next = idx >= 0
        ? prev.map((g, i) => i === idx ? { ...g, tables: [...g.tables, name] } : g)
        : [...prev, { label:'Custom', tables:[name] }]
      saveTableGroups(next)
      return next
    })
    setShowCreateModal(false); setSelectedTable(name)
  }

  // ── Filtered + sorted rows (search → filter conditions → sort rules) ───────
  const filteredRows = useMemo(() => {
    let out = rows
    // Level tests live in their own "Level Tests" tab, so keep them out of the lessons grid.
    if (selectedTable === T_LESSONS) out = out.filter(r => r.lesson_type !== 'level_test')
    // Tutors view: Active / Inactive / All tabs.
    if (selectedTable === T_TUTORS && tutorStatusTab !== 'all') {
      const wantActive = tutorStatusTab === 'active'
      out = out.filter(r => (r.active !== false) === wantActive)
    }
    // Students view: Active / Inactive / All tabs (by is_active, falling back to status).
    if (selectedTable === T_STUDENTS && studentStatusTab !== 'all') {
      const wantActive = studentStatusTab === 'active'
      out = out.filter(r => {
        const isActive = r.is_active != null ? r.is_active === 'Active' : ['active', 'trial'].includes(r.status)
        return isActive === wantActive
      })
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter(r => Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(q)))
    }
    // Conditions missing a value (where one is needed) are ignored, like Airtable
    const conds = filterCfg.conds.filter(c => c.col && (NO_VALUE_OPS.has(c.op) || String(c.value ?? '').trim() !== ''))
    if (conds.length) {
      out = out.filter(r => {
        const results = conds.map(c => applyFilterCondition(r[c.col], c.op, c.value))
        return filterCfg.conj === 'or' ? results.some(Boolean) : results.every(Boolean)
      })
    }
    if (sortRules.length) {
      out = [...out].sort((ra, rb) => {
        for (const rule of sortRules) {
          const c = cmpCellsDir(ra[rule.col], rb[rule.col], rule.dir)
          if (c !== 0) return c
        }
        return 0
      })
    }
    return out
  }, [rows, search, filterCfg, sortRules, selectedTable, tutorStatusTab, studentStatusTab])

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</div>
    </div>
  )

  const vConfig  = VIRTUAL[selectedTable]

  return (
    <div className="flex flex-col" style={{ height:'100dvh' }}>
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      {/* Column context menu */}
      {contextMenu && (
        <ColContextMenu
          x={contextMenu.x} y={contextMenu.y} col={contextMenu.col}
          isPk={contextMenu.col === pkCol}
          isGuardian={isGuardianCol(contextMenu.col) || isNameCol(contextMenu.col)}
          onRename={() => startColRename(contextMenu.col)}
          onHide={() => { hideCol(contextMenu.col); setContextMenu(null) }}
          onDelete={() => handleDropCol(contextMenu.col)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Enrolment popover */}
      {enrolPopover && (
        <EnrolPopover
          classId={enrolPopover.classId}
          x={enrolPopover.x}
          y={enrolPopover.y}
          enrolled={enrolmentMap[enrolPopover.classId] || []}
          allStudents={allStudentsList}
          onEnrol={handleEnrol}
          onClose={() => setEnrolPopover(null)}
          saving={enrolSaving}
        />
      )}

      {/* Sibling popover */}
      {siblingPopover && (
        <SiblingPopover
          studentId={siblingPopover.studentId}
          x={siblingPopover.x}
          y={siblingPopover.y}
          allStudents={allStudentsForSiblings}
          currentSiblings={siblingMap[siblingPopover.studentId] || []}
          onAdd={handleAddSibling}
          onClose={() => setSiblingPopover(null)}
          saving={siblingSaving}
        />
      )}

      {/* Add Student modal — students cards view */}
      {showAddStudentModal && (
        <AddStudentModal
          onClose={() => setShowAddStudentModal(false)}
          onAdded={() => { setShowAddStudentModal(false); setReloadKey(k => k + 1) }}
        />
      )}

      {/* Drop-in session modals */}
      {(showAddSession || editingSession) && (
        <SessionModal
          session={editingSession}
          onClose={() => { setShowAddSession(false); setEditingSession(null) }}
          onSaved={() => { setShowAddSession(false); setEditingSession(null); loadDropinSessions() }}
        />
      )}
      {addSigninFor && (
        <AddSigninModal
          sessionId={addSigninFor}
          existingSignins={dropinSessions.find(s => s.id === addSigninFor)?.signins ?? []}
          allStudents={dropinStudents}
          onClose={() => setAddSigninFor(null)}
          onAdded={() => { setAddSigninFor(null); loadDropinSessions() }}
        />
      )}
      {deleteSessionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-80 flex flex-col overflow-hidden border border-[#DEE7FF]">
            <div className="px-6 py-5">
              <p className="text-sm font-bold text-[#062E63] mb-2">Delete this session?</p>
              <p className="text-xs text-[#2A2035]/60">This will also remove all student sign-ins for this session. This cannot be undone.</p>
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setDeleteSessionId(null)} className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
              <button onClick={() => handleDeleteSession(deleteSessionId)} className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Price confirm dialog — enrolments only */}
      {priceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-80 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#DEE7FF] bg-[#F8FAFF]">
              <span className="text-sm font-bold text-[#062E63]">Confirm Price Change</span>
              <button onClick={() => setPriceConfirm(null)} className="w-6 h-6 flex items-center justify-center rounded-full text-[#2A2035]/30 hover:text-[#2A2035] hover:bg-[#F0F4FF] transition text-base">×</button>
            </div>
            <div className="px-5 py-5 flex flex-col gap-3">
              <p className="text-xs text-[#2A2035]/70 leading-relaxed">
                You are about to change this enrolment's price.
              </p>
              <div className="flex items-center gap-3 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-3">
                <div className="flex flex-col items-center flex-1">
                  <span className="text-[9px] font-semibold text-[#325099]/50 uppercase tracking-wider mb-0.5">Current</span>
                  <span className="text-lg font-bold text-[#2A2035]">{priceConfirm.oldVal !== null ? `$${Number(priceConfirm.oldVal).toLocaleString()}` : '—'}</span>
                </div>
                <span className="text-[#325099]/40 text-lg">→</span>
                <div className="flex flex-col items-center flex-1">
                  <span className="text-[9px] font-semibold text-[#325099]/50 uppercase tracking-wider mb-0.5">New</span>
                  <span className="text-lg font-bold text-[#065F46]">{priceConfirm.newVal !== null && priceConfirm.newVal !== '' ? `$${Number(priceConfirm.newVal).toLocaleString()}` : '—'}</span>
                </div>
              </div>
              <p className="text-[10px] text-[#2A2035]/40 leading-relaxed text-center">This will not automatically update any existing invoices.</p>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={() => setPriceConfirm(null)} className="flex-1 px-3 py-2 text-xs font-semibold text-[#2A2035]/60 bg-[#F4F4F4] rounded-lg hover:bg-[#E5E7EB] transition">Cancel</button>
              <button onClick={handlePriceConfirm} disabled={saving} className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] transition disabled:opacity-50">
                {saving ? 'Saving…' : 'Confirm Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create table modal */}
      {showCreateModal && <CreateTableModal onClose={() => setShowCreateModal(false)} onCreated={handleTableCreated} />}

      {/* Drop table confirm modal */}
      {/* ── Add Credit Modal ──────────────────────────────────────────────────── */}
      {creditModal && (
        <AddCreditModal
          members={creditModal.members}
          onClose={() => setCreditModal(null)}
          onSave={(fields) => handleAddCredit({ invoiceId: creditModal.invoiceId, ...fields })}
        />
      )}

      {/* ── Log Referral Modal ────────────────────────────────────────────────── */}
      {referralModal && (
        <ReferralModal
          students={allStudentsForReferral}
          onClose={() => setReferralModal(false)}
          onSave={handleLogReferral}
        />
      )}


      {dropConfirmCol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0 text-xl">⚠️</div>
              <div>
                <h3 className="font-bold text-[#2A2035] text-sm">Drop column?</h3>
                <p className="text-xs text-[#2A2035]/60 mt-1">This will permanently delete the column <code className="font-mono text-red-600">{dropConfirmCol.col}</code> from <code className="font-mono text-[#325099]">{dropConfirmCol.realTable}</code> and all its data. Undo is available.</p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#2A2035]/70">Type <span className="font-mono text-red-600">{dropConfirmCol.col}</span> to confirm</label>
              <input
                autoFocus
                value={dropColInput}
                onChange={e => setDropColInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && dropColInput === dropConfirmCol.col) execDropCol() }}
                className="w-full px-3 py-2 text-sm border border-[#DEE7FF] rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 font-mono"
                placeholder={dropConfirmCol.col}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDropConfirmCol(null); setDropColInput('') }} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
              <button onClick={execDropCol} disabled={dropColInput !== dropConfirmCol.col} className="px-5 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 transition disabled:opacity-40">Drop Column</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ────────────────────────────────────────────────────── */}
        <aside className="w-52 bg-[#111827] flex flex-col shrink-0 overflow-y-auto">
          <div className="px-4 pt-5 pb-3 border-b border-white/10 shrink-0">
            <p className="text-[9px] tracking-[0.35em] uppercase font-bold text-white/30 mb-0.5">Admin</p>
            <p className="text-sm font-bold text-white font-display">Database</p>
          </div>
          <div className="flex-1 py-1 overflow-y-auto">
            {tableGroups.map(group => (
              <div key={group.label} className="mb-1">
                <p className="px-4 pt-3 pb-1 text-[9px] tracking-[0.3em] uppercase font-bold text-white/25">{group.label}</p>
                {group.tables.map(t => {
                  const active     = t === selectedTable
                  const count      = rowCounts[t]
                  const isVirtual  = !!VIRTUAL[t]
                  const canEdit    = !isVirtual
                  const hovered    = hoveredTable === t
                  const isRenaming = renamingTable === t
                  const isDragging = dragTable === t
                  const dropBefore = sidebarDragOver?.table === t && sidebarDragOver?.position === 'before'
                  const dropAfter  = sidebarDragOver?.table === t && sidebarDragOver?.position === 'after'

                  return (
                    <div
                      key={t}
                      className="relative"
                      onMouseEnter={() => setHoveredTable(t)}
                      onMouseLeave={() => setHoveredTable(null)}
                      draggable={!isRenaming}
                      onDragStart={e => handleSidebarDragStart(e, t, group.label)}
                      onDragEnd={handleSidebarDragEnd}
                      onDragOver={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const mid  = rect.top + rect.height / 2
                        handleSidebarDragOver(e, t, e.clientY < mid ? 'before' : 'after')
                      }}
                      onDrop={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const mid  = rect.top + rect.height / 2
                        handleSidebarDrop(e, t, group.label, e.clientY < mid ? 'before' : 'after')
                      }}
                    >
                      {/* Drop indicator lines */}
                      {dropBefore && <div className="absolute top-0 left-2 right-2 h-0.5 bg-[#BACBFF] rounded-full z-10 pointer-events-none" />}
                      {dropAfter  && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#BACBFF] rounded-full z-10 pointer-events-none" />}

                      {isRenaming ? (
                        <div className="px-2 py-1 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <input ref={renameInputRef} type="text" value={renameValue} onChange={e => setRenameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_'))} onKeyDown={e => { if (e.key==='Enter') commitRename(); if (e.key==='Escape') cancelRename() }} disabled={renameWorking} className="flex-1 min-w-0 px-2 py-1 rounded text-xs font-mono bg-white/10 text-white border border-white/20 focus:outline-none focus:border-[#BACBFF] disabled:opacity-50" />
                            <button onClick={commitRename} disabled={renameWorking} className="w-5 h-5 flex items-center justify-center rounded bg-[#325099] text-white text-[10px] hover:bg-[#4A6CC0] transition disabled:opacity-40">{renameWorking ? '…' : '✓'}</button>
                            <button onClick={cancelRename} className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition text-xs">✕</button>
                          </div>
                          {renameError && <p className="text-[9px] text-red-400 px-1 leading-tight">{renameError}</p>}
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedTable(t)}
                          className={`w-full text-left pl-2 pr-4 py-1.5 flex items-center justify-between gap-1.5 transition-colors ${isDragging ? 'opacity-30' : ''} ${active ? 'bg-[#325099] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
                        >
                          {/* Drag handle */}
                          <span
                            className={`shrink-0 text-[11px] leading-none cursor-grab active:cursor-grabbing select-none transition-opacity ${hovered ? 'opacity-40 hover:opacity-80' : 'opacity-0'}`}
                            title="Drag to reorder"
                          >⠿</span>
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="text-xs font-medium truncate">{t}</span>
                            {isVirtual && <span className={`text-[8px] shrink-0 ${active ? 'text-white/50' : 'text-white/20'}`}>⊂</span>}
                          </div>
                          {count !== undefined && !hovered && (
                            <span className={`text-[9px] tabular-nums shrink-0 font-semibold ${active ? 'text-white/60' : 'text-white/25'}`}>{count.toLocaleString()}</span>
                          )}
                          {canEdit && hovered && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <span onClick={e => { e.stopPropagation(); startRename(t) }} title={`Rename "${t}"`} className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-blue-300 hover:bg-blue-900/30 transition text-[10px] cursor-pointer">✏️</span>
                              <span onClick={e => { e.stopPropagation(); setDropConfirmTable(t); setDropTableInput(''); setDdlError(null) }} title={`Drop "${t}"`} className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-red-400 hover:bg-red-900/30 transition text-[10px] cursor-pointer">🗑</span>
                            </div>
                          )}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* ── MAIN ───────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-[9px] tracking-[0.25em] uppercase text-[#325099] font-bold">Table</p>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#2A2035] font-display leading-tight truncate">{selectedTable}</h2>
                  {vConfig && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] shrink-0 whitespace-nowrap">view of {vConfig.realTable}</span>}
                </div>
              </div>
              {rowCounts[selectedTable] !== undefined && <span className="text-[10px] font-semibold text-[#2A2035]/40 shrink-0">{rowCounts[selectedTable].toLocaleString()} rows</span>}
              {saving && <span className="text-[10px] font-semibold text-[#325099]/60 shrink-0 animate-pulse">Saving…</span>}
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-end">
              {/* Undo button removed — Ctrl/Cmd+Z (via GlobalUndo) drives handleUndo */}
              {undoing && <span className="text-[10px] font-semibold text-[#325099]/60 animate-pulse shrink-0">Undoing…</span>}

              {/* Rename button removed — rename via the ✏️ that appears when hovering a table name in the sidebar */}

              {/* Data quality (read-only checks) */}
              <button onClick={() => router.push('/tutor/database/quality')} className="flex items-center gap-1.5 px-3 py-1.5 text-[#065F46] border border-[#A7F3D0] text-xs font-semibold rounded-lg hover:bg-[#ECFDF5] transition" title="Read-only data quality checks — duplicates, orphans, invalid emails/phones, inconsistent values">
                ✓ Data Quality
              </button>

              {/* Sort */}
              <div className="relative">
                <button ref={sortBtnRef} onClick={() => { setSortOpen(o => !o); setFilterOpen(false) }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${sortRules.length ? 'bg-[#DEE7FF] text-[#062E63] border-[#BACBFF]' : 'text-[#325099] border-[#DEE7FF] hover:bg-[#F0F4FF]'}`}
                  title="Sort rows by one or more columns">
                  ⇅ Sort{sortRules.length > 0 && <span className="text-[10px] font-bold bg-[#325099] text-white rounded-full px-1.5">{sortRules.length}</span>}
                </button>
                {sortOpen && (
                  <SortPanel
                    anchorRef={sortBtnRef}
                    onClose={() => setSortOpen(false)}
                    columns={columnOrder}
                    labelOf={(c) => columnLabel(VIRTUAL[selectedTable]?.realTable ?? selectedTable, c)}
                    rules={sortRules}
                    onChange={updateSortRules}
                  />
                )}
              </div>

              {/* Filter */}
              <div className="relative">
                <button ref={filterBtnRef} onClick={() => { setFilterOpen(o => !o); setSortOpen(false) }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${filterCfg.conds.length ? 'bg-[#DEE7FF] text-[#062E63] border-[#BACBFF]' : 'text-[#325099] border-[#DEE7FF] hover:bg-[#F0F4FF]'}`}
                  title="Filter rows by conditions">
                  ≋ Filter{filterCfg.conds.length > 0 && <span className="text-[10px] font-bold bg-[#325099] text-white rounded-full px-1.5">{filterCfg.conds.length}</span>}
                </button>
                {filterOpen && (
                  <FilterPanel
                    anchorRef={filterBtnRef}
                    onClose={() => setFilterOpen(false)}
                    columns={columnOrder}
                    labelOf={(c) => columnLabel(VIRTUAL[selectedTable]?.realTable ?? selectedTable, c)}
                    optionsFor={(c) => cellDropdownFor(selectedTable, c)}
                    cfg={filterCfg}
                    onChange={updateFilterCfg}
                  />
                )}
              </div>

              {/* Search */}
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#325099]/40 text-xs pointer-events-none">🔍</span>
                <input type="text" placeholder="Search rows…" value={search} onChange={e => setSearch(e.target.value)} className="pl-7 pr-7 py-1.5 text-xs rounded-lg border border-[#DEE7FF] bg-white text-[#2A2035] placeholder-[#2A2035]/30 focus:outline-none focus:border-[#BACBFF] w-44 transition" />
                {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#2A2035]/30 hover:text-[#2A2035]/60 text-xs">✕</button>}
              </div>

              {/* Term filter — shown for classes, enrolments, lessons, invoices */}
              {TERM_SCOPED.has(selectedTable) && allTerms.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[#325099]/50 shrink-0">Term</span>
                  <select
                    value={dbTermFilter ?? ''}
                    onChange={e => setDbTermFilter(e.target.value || null)}
                    className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] max-w-[150px]"
                  >
                    <option value="">All terms</option>
                    {allTerms.map(t => (
                      <option key={t.id} value={t.id}>{t.name || `Term ${t.term_number} ${t.year}`}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Active / Inactive tabs — tutors only */}
              {selectedTable === T_TUTORS && (
                <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
                  {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, label], i) => (
                    <button
                      key={v}
                      onClick={() => setTutorStatusTab(v)}
                      className={`px-3 py-1.5 text-xs font-semibold transition ${i > 0 ? 'border-l border-[#DEE7FF]' : ''} ${tutorStatusTab === v ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Active / Inactive tabs — students only */}
              {selectedTable === T_STUDENTS && (
                <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
                  {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, label], i) => (
                    <button
                      key={v}
                      onClick={() => setStudentStatusTab(v)}
                      className={`px-3 py-1.5 text-xs font-semibold transition ${i > 0 ? 'border-l border-[#DEE7FF]' : ''} ${studentStatusTab === v ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {selectedTable === 'lessons' ? (
                <>
                  {/* Lessons / Level Tests tab toggle */}
                  <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
                    <button onClick={() => setLessonViewMode('lessons')} className={`px-3 py-1.5 text-xs font-semibold transition ${lessonViewMode === 'lessons' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>⊞ Lessons</button>
                    <button onClick={() => { setLessonViewMode('level_tests'); setLessonClassFilter('') }} className={`px-3 py-1.5 text-xs font-semibold transition border-l border-[#DEE7FF] ${lessonViewMode === 'level_tests' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>📝 Level Tests</button>
                  </div>
                  {lessonViewMode === 'lessons' && (
                  <select
                    value={lessonClassFilter}
                    onChange={e => setLessonClassFilter(e.target.value)}
                    className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] max-w-[200px]"
                  >
                    <option value="">All classes</option>
                    {allClassesForFilter.map(c => (
                      <option key={c.id} value={c.id}>{c.class_name} ({c.day_of_week})</option>
                    ))}
                  </select>
                  )}
                  {lessonViewMode === 'lessons' && (
                  <button
                    onClick={handleGenerateLessons}
                    disabled={!lessonClassFilter || generatingLessons || loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#065F46] text-white text-xs font-semibold rounded-lg hover:bg-[#047857] transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Generate weekly lesson rows for the selected class based on its term schedule"
                  >
                    {generatingLessons ? '⟳ Generating…' : '⟳ Generate Lessons'}
                  </button>
                  )}
                  <button onClick={() => openAddLessonModal(lessonViewMode === 'level_tests' ? 'level_test' : 'class')} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                    <span className="text-sm leading-none">+</span> {lessonViewMode === 'level_tests' ? 'Add Level Test' : 'Add Lesson'}
                  </button>
                </>
              ) : selectedTable === T_STUDENTS ? (
                <>
                  {/* Data / Cards toggle */}
                  <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
                    <button onClick={() => setStudentViewMode('data')} className={`px-3 py-1.5 text-xs font-semibold transition ${studentViewMode === 'data' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>⊞ Data</button>
                    <button onClick={() => setStudentViewMode('cards')} className={`px-3 py-1.5 text-xs font-semibold transition border-l border-[#DEE7FF] ${studentViewMode === 'cards' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>◧ Directory</button>
                  </div>
                  {studentViewMode === 'cards' ? (
                    <button onClick={() => setShowAddStudentModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition">
                      <span className="text-sm leading-none">+</span> Add Student
                    </button>
                  ) : (
                    <button onClick={() => { setAddingRow(true); setNewRowData({}); setDeleteConfirm(null) }} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                      <span className="text-sm leading-none">+</span> Add Student
                    </button>
                  )}
                </>
              ) : selectedTable === T_DROPIN_SESSIONS ? (
                <>
                  <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
                    <button onClick={() => setDropinViewMode('data')} className={`px-3 py-1.5 text-xs font-semibold transition ${dropinViewMode === 'data' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>⊞ Data</button>
                    <button onClick={() => setDropinViewMode('sessions')} className={`px-3 py-1.5 text-xs font-semibold transition border-l border-[#DEE7FF] ${dropinViewMode === 'sessions' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>◧ Sessions</button>
                  </div>
                  {dropinViewMode === 'sessions' ? (
                    <button onClick={() => setShowAddSession(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition">
                      <span className="text-sm leading-none">+</span> New Session
                    </button>
                  ) : (
                    <button onClick={() => { setAddingRow(true); setNewRowData({}); setDeleteConfirm(null) }} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                      <span className="text-sm leading-none">+</span> Add Row
                    </button>
                  )}
                </>
              ) : selectedTable === 'classes' ? (
                /* Term rollovers live on the dedicated /tutor/transition page */
                <button onClick={openAddClassModal} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-sm leading-none">+</span> Add Class
                </button>
              ) : selectedTable === T_ENROLMENTS ? (
                <button onClick={() => setShowAddEnrolmentModal(true)} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-sm leading-none">+</span> Add Enrolment
                </button>
              ) : selectedTable === T_COURSES ? (
                <button onClick={openAddCourseModal} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-sm leading-none">+</span> Add Course
                </button>
              ) : selectedTable === T_PARENTS ? (
                <>
                  {/* Families / Data toggle */}
                  <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
                    <button onClick={() => setGuardianViewMode('families')} className={`px-3 py-1.5 text-xs font-semibold transition ${guardianViewMode === 'families' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>◧ Families</button>
                    <button onClick={() => setGuardianViewMode('data')} className={`px-3 py-1.5 text-xs font-semibold transition border-l border-[#DEE7FF] ${guardianViewMode === 'data' ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>⊞ Data</button>
                  </div>
                  {guardianViewMode === 'data' && (
                    <button onClick={() => { setAddingRow(true); setNewRowData({}); setDeleteConfirm(null) }} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                      <span className="text-sm leading-none">+</span> Add Row
                    </button>
                  )}
                </>
              ) : (
                <button onClick={() => { setAddingRow(true); setNewRowData({}); setDeleteConfirm(null) }} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-sm leading-none">+</span> Add Row
                </button>
              )}
            </div>
          </div>

          {/* Hidden columns restore bar */}
          {hiddenCols.size > 0 && (
            <div className="flex items-center gap-1.5 px-5 py-1 bg-[#F8FAFF] border-b border-[#DEE7FF] shrink-0">
              <span className="text-[10px] text-[#325099]/40 select-none">{hiddenCols.size} hidden:</span>
              {[...hiddenCols].map(col => (
                <button key={col} onClick={() => restoreCol(col)} className="text-[10px] px-2 py-0.5 rounded-full bg-[#EEF1F8] text-[#325099]/60 hover:bg-[#DEE7FF] hover:text-[#325099] transition font-mono">
                  {col} ×
                </button>
              ))}
              <button onClick={restoreAllCols} className="ml-auto text-[10px] text-[#325099]/40 hover:text-[#325099] transition">
                show all
              </button>
            </div>
          )}

          {/* Hint bar */}
          {columns.length > 0 && !loading && (
            <div className="flex items-center gap-4 px-5 py-1.5 bg-[#F0F4FF] border-b border-[#DEE7FF] text-[10px] text-[#325099]/50 shrink-0 select-none">
              <span>↔ Drag header to reorder</span>
              <span>⟺ Drag right edge to resize</span>
              <span>Double-click header to hide column</span>
              <span>Right-click header to rename or delete column</span>
              {vConfig?.joinParents && <span className="text-amber-600/60">Guardian cols update the <strong>parents</strong> table</span>}
            </div>
          )}

          {/* Grid */}
          <div className="flex-1 overflow-auto">

            {/* ── Families view (guardians table) ────────────────────────────── */}
            {selectedTable === T_PARENTS && guardianViewMode === 'families' ? (
              <FamiliesView key={reloadKey} />
            ) :

            /* ── Student Directory view ─────────────────────────────────────── */
            selectedTable === T_STUDENTS && studentViewMode === 'cards' ? (
              loadingStudentCards ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p>
                </div>
              ) : (() => {
                const q = studentCardsSearch.trim().toLowerCase()
                let filtered = q
                  ? studentCardsData.filter(s => (s.full_name||'').toLowerCase().includes(q) || (s.email||'').toLowerCase().includes(q) || (s.year||'').includes(q))
                  : studentCardsData
                if (studentStatusTab !== 'all') {
                  const wantActive = studentStatusTab === 'active'
                  filtered = filtered.filter(s => ['active', 'trial'].includes(s.status) === wantActive)
                }
                const selected = filtered.find(s => s.id === studentCardsSelected) ?? null
                const selectedParent = selected ? (studentCardsParents[selected.id] ?? null) : null
                return (
                  <div className="h-full flex flex-col">
                    {/* Search + count bar */}
                    <div className="flex items-center gap-3 px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
                      <div className="relative flex-1 max-w-sm">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#325099]/50 text-sm">🔍</span>
                        <input type="text" placeholder="Search by name, email, or year…" value={studentCardsSearch} onChange={e => { setStudentCardsSearch(e.target.value); setStudentCardsSelected(null) }} className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#DEE7FF] bg-white text-[#2A2035] placeholder-[#2A2035]/40 focus:outline-none focus:border-[#BACBFF] transition" />
                      </div>
                      <span className="text-[10px] text-[#325099]/50 font-semibold shrink-0">{filtered.length} {q ? 'found' : 'students'}</span>
                    </div>
                    {/* Side-by-side panels */}
                    <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x divide-[#DEE7FF]">
                      {/* LEFT — student list */}
                      <div className="flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
                          <div className="w-7 h-7 rounded-xl bg-[#DEE7FF] flex items-center justify-center text-sm">🎓</div>
                          <p className="text-xs font-semibold text-[#2A2035] font-display">{filtered.length} {q ? 'found' : 'enrolled'}</p>
                          {studentCardsSelected && (
                            <button onClick={() => setStudentCardsSelected(null)} className="ml-auto text-[10px] font-semibold text-[#325099] hover:text-[#062E63] px-2 py-1 rounded-lg hover:bg-[#DEE7FF] transition">Clear</button>
                          )}
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-[#DEE7FF]">
                          {filtered.length === 0 ? (
                            <div className="text-center py-12">
                              <p className="text-3xl mb-2">🔍</p>
                              <p className="text-sm font-semibold text-[#2A2035]">No students match</p>
                            </div>
                          ) : filtered.map(s => {
                            const isActive = studentCardsSelected === s.id
                            const enrolCount = studentCardsEnrolments[s.id] || 0
                            return (
                              <button key={s.id} onClick={() => setStudentCardsSelected(isActive ? null : s.id)} className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition group ${isActive ? 'bg-[#EEF4FF] border-l-2 border-l-[#325099]' : 'hover:bg-[#F8FAFF] border-l-2 border-l-transparent'}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isActive ? 'bg-[#325099] text-white' : 'bg-[#DEE7FF] text-[#325099]'}`}>
                                  {(s.full_name || '?').charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-semibold text-[#2A2035] font-display">{s.full_name}</span>
                                    {s.year && <SDBadge text={`Yr ${s.year}`} cls={yearBadgeColor(s.year)} />}
                                    {enrolCount > 0 && <SDBadge text={`${enrolCount} class${enrolCount === 1 ? '' : 'es'}`} cls="bg-[#DEE7FF] text-[#062E63]" />}
                                    {s.gender && <SDBadge text={s.gender} cls="bg-[#FCE7F3] text-[#9D174D]" />}
                                    {s.status && s.status !== 'active' && <SDBadge text={s.status} cls={s.status === 'trial' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-gray-100 text-gray-500 border border-gray-200'} />}
                                  </div>
                                  <p className="text-[11px] text-[#2A2035]/55 mt-0.5 truncate">{s.email || '—'}</p>
                                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#2A2035]/40">
                                    <span className="font-mono">ID: {shortId(s.id)}</span>
                                    {s.school && <span>· {s.school}</span>}
                                  </div>
                                </div>
                                <span className={`text-sm shrink-0 mt-1 transition-transform ${isActive ? 'text-[#325099]' : 'text-[#2A2035]/30 group-hover:text-[#325099]'}`}>{isActive ? '→' : '›'}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      {/* RIGHT — guardian details */}
                      <div className="flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
                          <div className="w-7 h-7 rounded-xl bg-[#FEF3C7] flex items-center justify-center text-sm">👨‍👩‍👧</div>
                          <p className="text-xs font-semibold text-[#2A2035] font-display">{selected ? `Guardian of ${selected.full_name}` : 'Parents / Guardians'}</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5">
                          {!selected ? (
                            <div className="flex flex-col items-center justify-center h-full text-center py-16">
                              <div className="w-12 h-12 rounded-2xl bg-[#FEF3C7] flex items-center justify-center text-2xl mb-3">👈</div>
                              <p className="text-sm font-semibold text-[#2A2035]">No student selected</p>
                              <p className="text-xs text-[#2A2035]/50 mt-1.5 max-w-xs">Click a student on the left to view their details.</p>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {/* Linked student chip */}
                              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#EEF4FF] border border-[#DEE7FF]">
                                <div className="w-6 h-6 rounded-full bg-[#325099] text-white text-xs font-bold flex items-center justify-center shrink-0">{(selected.full_name||'?').charAt(0)}</div>
                                <span className="text-xs font-semibold text-[#325099]">{selected.full_name}</span>
                                {selected.year && <span className="text-[10px] text-[#2A2035]/50 ml-1">· Year {selected.year}</span>}
                                <span className="ml-auto text-[10px] font-semibold text-[#325099]/60 tracking-wide">linked student</span>
                              </div>
                              {/* Status selector */}
                              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white border border-[#DEE7FF]">
                                <span className="text-[11px] font-semibold text-[#2A2035]/60">Enrolment status</span>
                                <select
                                  value={selected.status || 'active'}
                                  onChange={async (e) => {
                                    const newStatus = e.target.value
                                    const { error } = await supabase.from(T_STUDENTS).update({ status: newStatus }).eq('id', selected.id)
                                    if (error) { alert(`Failed to update status: ${error.message}`); return }
                                    setStudentCardsData(prev => prev.map(s => s.id === selected.id ? { ...s, status: newStatus } : s))
                                  }}
                                  className="text-[11px] font-bold rounded-lg px-2.5 py-1 border focus:outline-none focus:ring-2 focus:ring-[#325099]/20 cursor-pointer transition"
                                  style={
                                    (selected.status || 'active') === 'active' ? { background:'#D1FAE5', color:'#065F46', borderColor:'#6EE7B7' } :
                                    selected.status === 'trial'                 ? { background:'#FEF3C7', color:'#92400E', borderColor:'#FDE68A' } :
                                    { background:'#F3F4F6', color:'#6B7280', borderColor:'#D1D5DB' }
                                  }
                                >
                                  <option value="active">Active</option>
                                  <option value="trial">Trial</option>
                                  <option value="disenrol">Disenrol</option>
                                  <option value="quit trial">Quit trial</option>
                                </select>
                              </div>
                              {/* Guardian card */}
                              {!selectedParent ? (
                                <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-dashed border-[#DEE7FF] text-[#2A2035]/40">
                                  <span className="text-lg">📭</span>
                                  <span className="text-xs">No guardian on file</span>
                                </div>
                              ) : (
                                <div className="rounded-2xl border border-[#DEE7FF] p-5 bg-[#FAFBFF]">
                                  <div className="flex items-start gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center text-base font-bold text-[#92400E] shrink-0">{(selectedParent.full_name||'?').charAt(0)}</div>
                                    <div>
                                      <p className="text-base font-semibold text-[#2A2035] font-display">{selectedParent.full_name || '—'}</p>
                                      {selectedParent.relationship && <SDBadge text={selectedParent.relationship} cls="bg-[#FEF3C7] text-[#92400E] mt-0.5" />}
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <SDDetailRow icon="✉️" label="Email" value={selectedParent.email} />
                                    <SDDetailRow icon="📞" label="Phone" value={selectedParent.phone} />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()
            ) : null}

            {/* ── Drop-in Sessions view ──────────────────────────────────────── */}
            {selectedTable === T_DROPIN_SESSIONS && dropinViewMode === 'sessions' ? (
              loadingDropin ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {/* Empty state */}
                  {dropinSessions.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                      <p className="text-4xl">📋</p>
                      <p className="text-sm font-semibold text-[#2A2035]">No drop-in sessions yet</p>
                      <button onClick={() => setShowAddSession(true)} className="px-4 py-2 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition">+ New Session</button>
                    </div>
                  )}
                  {/* Session cards */}
                  <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
                    {dropinSessions.map(session => {
                      const fmt12 = t => {
                        if (!t) return ''
                        const [h, m] = t.split(':').map(Number)
                        const ampm = h >= 12 ? 'pm' : 'am'
                        return `${h % 12 || 12}:${String(m).padStart(2,'0')}${ampm}`
                      }
                      const dateStr = session.session_date
                        ? new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
                        : '—'
                      const isFull = session.signins.length >= session.max_capacity
                      const spotsLeft = session.max_capacity - session.signins.length
                      const capacityColour = isFull
                        ? 'text-[#991B1B] bg-[#FEE2E2]'
                        : spotsLeft <= 2 ? 'text-[#92400E] bg-[#FEF3C7]'
                        : 'text-[#065F46] bg-[#D1FAE5]'

                      return (
                        <div key={session.id} className="bg-white rounded-2xl border border-[#E8EDF8] shadow-sm flex flex-col overflow-hidden hover:shadow-md transition-shadow">
                          {/* Card header */}
                          <div className="px-5 pt-5 pb-4 border-b border-[#F0F4FF]">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-[#062E63]">{dateStr}</p>
                                <p className="text-xs text-[#2A2035]/60 mt-0.5">{fmt12(session.start_time)} – {fmt12(session.end_time)} · {session.location || '—'}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${capacityColour}`}>
                                  {session.signins.length}/{session.max_capacity} booked
                                </span>
                              </div>
                            </div>
                            {/* Subjects + Tutors */}
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {(session.subjects || []).map(s => (
                                <span key={s} className="text-[10px] font-semibold bg-[#EEF4FF] text-[#325099] px-2 py-0.5 rounded-full border border-[#DEE7FF]">{s}</span>
                              ))}
                            </div>
                            {(session.tutors || []).length > 0 && (
                              <p className="mt-2 text-[10px] text-[#2A2035]/50">
                                <span className="font-semibold text-[#2A2035]/40 uppercase tracking-wider mr-1">Tutors:</span>
                                {session.tutors.join(', ')}
                              </p>
                            )}
                            {session.notes && (
                              <p className="mt-1.5 text-[10px] text-[#2A2035]/50 italic">{session.notes}</p>
                            )}
                            {/* Edit / Delete */}
                            <div className="mt-3 flex gap-2">
                              <button onClick={() => setEditingSession(session)} className="text-[10px] font-semibold text-[#325099] hover:underline">Edit session</button>
                              <span className="text-[#2A2035]/20">·</span>
                              <button onClick={() => setDeleteSessionId(session.id)} className="text-[10px] font-semibold text-red-400 hover:underline">Delete</button>
                            </div>
                          </div>

                          {/* Signins */}
                          <div className="px-5 py-3 flex flex-col gap-1.5 flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#325099]/60 mb-1">
                              Attendees {session.signins.length > 0 ? `(${session.signins.length})` : ''}
                            </p>
                            {session.signins.length === 0 && (
                              <p className="text-[10px] text-[#2A2035]/30 italic pl-1">No students booked in yet</p>
                            )}
                            {session.signins.map(si => {
                              const stu = dropinStudents.find(s => s.id === si.student_id)
                              const statusColour = si.status === 'attended'
                                ? 'text-[#065F46] bg-[#D1FAE5] border-[#6EE7B7]'
                                : si.status === 'absent'
                                ? 'text-[#991B1B] bg-[#FEE2E2] border-[#FCA5A5]'
                                : 'text-[#1e40af] bg-[#EEF4FF] border-[#BFDBFE]'
                              return (
                                <div key={si.id} className="flex items-start gap-2 px-2.5 py-2 rounded-xl bg-[#FAFBFF] border border-[#F0F4FF]">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-semibold text-[#062E63] truncate">{stu?.full_name ?? si.student_id}</span>
                                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusColour}`}>{si.status}</span>
                                      <span className="text-[10px] text-[#325099]/60 font-medium">{si.subject}</span>
                                    </div>
                                    {si.question && <p className="text-[10px] text-[#2A2035]/40 mt-0.5 truncate">{si.question}</p>}
                                  </div>
                                  <button
                                    onClick={() => handleRemoveSignin(session.id, si.id)}
                                    title="Remove"
                                    className="text-[#2A2035]/25 hover:text-red-400 transition text-sm leading-none shrink-0 pt-0.5"
                                  >×</button>
                                </div>
                              )
                            })}
                          </div>

                          {/* Add student footer */}
                          <div className="px-5 pb-5 pt-2">
                            <button
                              onClick={() => setAddSigninFor(session.id)}
                              disabled={isFull}
                              className="w-full py-2 rounded-xl border border-dashed border-[#DEE7FF] text-[11px] font-semibold text-[#325099]/60 hover:border-[#325099] hover:text-[#325099] hover:bg-[#F8FAFF] transition disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {isFull ? 'Session full' : '+ Add student'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            ) : null}

            {/* ── Invoice Cards view ─────────────────────────────────────────── */}
            {selectedTable === T_INVOICES && invoiceViewMode === 'cards' ? (
              loadingCards ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p>
                </div>
              ) : !invoiceTermId ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <p className="text-3xl">🧾</p>
                  <p className="text-sm font-semibold text-[#2A2035]">Select a term to view invoices</p>
                </div>
              ) : invoiceCardsData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <p className="text-3xl">📭</p>
                  <p className="text-sm font-semibold text-[#2A2035]">No invoices for this term</p>
                  <p className="text-xs text-[#2A2035]/40">Click Generate Invoices to create them</p>
                </div>
              ) : (
                <div className="flex flex-col">
                {/* ── Summary banner ─────────────────────────────────────────── */}
                {(() => {
                  const totalSubtotal      = invoiceCardsData.reduce((s, i) => s + Number(i.subtotal || 0), 0)
                  const totalSibDisc       = invoiceCardsData.reduce((s, i) => s + Number(i.sibling_discount || 0), 0)
                  const totalMultiDisc     = invoiceCardsData.reduce((s, i) => s + Number(i.multi_course_discount || 0), 0)
                  const totalCredits       = invoiceCardsData.reduce((s, i) => s + Number(i.creditsTotal || 0), 0)
                  const totalDiscounts     = totalSibDisc + totalMultiDisc + totalCredits
                  const adjTotal = i => Number(i.adjustedTotal != null ? i.adjustedTotal : (i.total || 0))
                  const totalAfterDiscount = invoiceCardsData.reduce((s, i) => s + adjTotal(i), 0)
                  const paidAmt    = invoiceCardsData.filter(i => i.status === 'paid').reduce((s, i) => s + adjTotal(i), 0)
                  const unpaidAmt  = invoiceCardsData.filter(i => i.status === 'unpaid').reduce((s, i) => s + adjTotal(i), 0)
                  const fmt = n => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  return (
                    <div className="mx-6 mt-6 mb-2 bg-white rounded-2xl border border-[#E8EDF8] shadow-sm overflow-hidden">
                      {/* Top row: main 3 stats */}
                      <div className="grid grid-cols-3 divide-x divide-[#F0F4FF]">
                        <div className="px-6 py-4">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2A2035]/40 mb-1">Gross subtotal</p>
                          <p className="text-xl font-bold text-[#062E63] tabular-nums">{fmt(totalSubtotal)}</p>
                          <p className="text-[10px] text-[#2A2035]/40 mt-0.5">across {invoiceCardsData.length} invoice{invoiceCardsData.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="px-6 py-4">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#059669]/70 mb-1">Total discounts</p>
                          <p className="text-xl font-bold text-[#059669] tabular-nums">−{fmt(totalDiscounts)}</p>
                          <p className="text-[10px] text-[#2A2035]/40 mt-0.5 flex flex-wrap gap-x-1">
                            {totalSibDisc > 0 && <span>Sibling {fmt(totalSibDisc)}</span>}
                            {totalSibDisc > 0 && totalMultiDisc > 0 && <span>·</span>}
                            {totalMultiDisc > 0 && <span>Multi-course {fmt(totalMultiDisc)}</span>}
                            {totalCredits > 0 && totalSibDisc + totalMultiDisc > 0 && <span>·</span>}
                            {totalCredits > 0 && <span>Credits {fmt(totalCredits)}</span>}
                            {totalDiscounts === 0 && <span>No discounts applied</span>}
                          </p>
                        </div>
                        <div className="px-6 py-4">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#325099]/70 mb-1">Net total</p>
                          <p className="text-xl font-bold text-[#325099] tabular-nums">{fmt(totalAfterDiscount)}</p>
                          <p className="text-[10px] text-[#2A2035]/40 mt-0.5">after all discounts</p>
                        </div>
                      </div>
                      {/* Bottom row: payment status breakdown */}
                      <div className="border-t border-[#F0F4FF] grid grid-cols-2 divide-x divide-[#F0F4FF] bg-[#FAFBFF]">
                        <div className="px-6 py-2.5 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#059669] shrink-0" />
                          <span className="text-[10px] text-[#2A2035]/50 font-medium">Paid</span>
                          <span className="ml-auto text-[11px] font-bold text-[#065F46] tabular-nums">{fmt(paidAmt)}</span>
                          <span className="text-[10px] text-[#2A2035]/30">({invoiceCardsData.filter(i => i.status === 'paid').length})</span>
                        </div>
                        <div className="px-6 py-2.5 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#EF4444] shrink-0" />
                          <span className="text-[10px] text-[#2A2035]/50 font-medium">Unpaid</span>
                          <span className="ml-auto text-[11px] font-bold text-[#991B1B] tabular-nums">{fmt(unpaidAmt)}</span>
                          <span className="text-[10px] text-[#2A2035]/30">({invoiceCardsData.filter(i => i.status === 'unpaid').length})</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
                {/* ── Cards grid ─────────────────────────────────────────────── */}
                <div className="p-6 grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4 content-start">
                  {invoiceCardsData.map(inv => {
                    const statusColour = inv.status === 'paid'
                      ? { bg: 'bg-[#D1FAE5]', text: 'text-[#065F46]', border: 'border-[#6EE7B7]', dot: 'bg-[#059669]' }
                      : { bg: 'bg-[#FEE2E2]', text: 'text-[#991B1B]', border: 'border-[#FCA5A5]', dot: 'bg-[#EF4444]' }
                    const nextStatus = inv.status === 'unpaid' ? 'paid' : 'unpaid'
                    const statusLabels = { unpaid: 'Unpaid', paid: 'Paid' }
                    const handleToggleEmailSent = async () => {
                      const newVal = !inv.email_sent
                      const now = newVal ? new Date().toISOString() : null
                      setInvoiceCardsData(d => d.map(c => c.id === inv.id ? { ...c, email_sent: newVal, email_sent_at: now } : c))
                      await supabase.from(T_INVOICES).update({ email_sent: newVal, email_sent_at: now }).eq('id', inv.id)
                    }

                    const liveSubtotal = inv.members.reduce((sum, m) => sum + m.enrolments.reduce((s, e) => s + Number(e.price ?? 0), 0), 0)
                    const isStale = Math.abs(liveSubtotal - Number(inv.subtotal)) > 0.01

                    return (
                      <div key={inv.id} className="bg-white rounded-2xl border border-[#E8EDF8] shadow-sm flex flex-col overflow-hidden hover:shadow-md transition-shadow">
                        {/* Stale warning banner */}
                        {isStale && (
                          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200">
                            <span className="text-amber-500 text-sm">⚠</span>
                            <p className="text-[11px] text-amber-700 font-medium">
                              {inv.status === 'paid'
                                ? 'New enrolments since payment — re-run Generate Invoices to create a new invoice.'
                                : 'Enrolments have changed — re-run Generate Invoices to update totals.'}
                            </p>
                          </div>
                        )}
                        {/* Card header */}
                        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#F0F4FF]">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              {inv.isFamily && <span className="text-[9px] font-bold uppercase tracking-wider text-[#325099]/50 bg-[#F0F4FF] px-1.5 py-0.5 rounded-full">Family</span>}
                              <h3 className="text-sm font-bold text-[#062E63]">{inv.displayName}</h3>
                            </div>
                            <p className="text-[10px] text-[#2A2035]/40 font-medium">{inv.termName}</p>
                          </div>
                          {/* Badges */}
                          <div className="flex items-center gap-2 flex-col">
                            {/* Paid/Unpaid — click to cycle */}
                            <button
                              onClick={() => handleInvoiceStatusUpdate(inv.id, nextStatus)}
                              title={`Click to mark as ${statusLabels[nextStatus]}`}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition hover:opacity-80 ${statusColour.bg} ${statusColour.text} ${statusColour.border}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${statusColour.dot}`} />
                              {statusLabels[inv.status]}
                            </button>
                            {/* Email sent toggle */}
                            <button
                              onClick={handleToggleEmailSent}
                              title={inv.email_sent ? `Sent ${inv.email_sent_at ? new Date(inv.email_sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}· Click to unmark` : 'Click to mark as sent'}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition hover:opacity-80 ${
                                inv.email_sent
                                  ? 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]'
                                  : 'bg-white text-[#2A2035]/30 border-[#E5E7EB] hover:border-[#BFDBFE] hover:text-[#1D4ED8]'
                              }`}
                            >
                              <span>{inv.email_sent ? '✉' : '✉'}</span>
                              {inv.email_sent ? 'Sent' : 'Not sent'}
                            </button>
                          </div>
                        </div>

                        {/* Enrolment breakdown per student */}
                        <div className="px-5 py-3 flex flex-col gap-3 flex-1">
                          {inv.members.map(member => (
                            <div key={member.id}>
                              <p className="text-[10px] font-bold text-[#325099] uppercase tracking-wider mb-1">{member.full_name}</p>
                              {member.enrolments.length === 0 ? (
                                <p className="text-[10px] text-[#2A2035]/30 italic pl-2">No priced enrolments</p>
                              ) : member.enrolments.map((e, i) => (
                                <div key={i} className="flex items-center justify-between py-0.5 pl-2">
                                  <span className="text-xs text-[#2A2035]/70">{e.label}</span>
                                  <span className="text-xs font-semibold text-[#2A2035] tabular-nums">
                                    {e.price != null ? `$${Number(e.price).toLocaleString()}` : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>

                        {/* Totals footer */}
                        <div className="px-5 pb-4 pt-3 border-t border-[#F0F4FF] flex flex-col gap-1">
                          <div className="flex justify-between text-xs text-[#2A2035]/60">
                            <span>Subtotal</span>
                            <span className="tabular-nums">${Number(inv.subtotal).toLocaleString()}</span>
                          </div>
                          {Number(inv.sibling_discount) > 0 && (
                            <div className="flex justify-between text-xs text-[#059669]">
                              <span>Sibling discount ({inv.members.length}×)</span>
                              <span className="tabular-nums">−${Number(inv.sibling_discount).toLocaleString()}</span>
                            </div>
                          )}
                          {Number(inv.multi_course_discount) > 0 && (
                            <div className="flex justify-between text-xs text-[#7C3AED]">
                              <span>
                                Multi-course discount
                                <span className="ml-1 text-[9px] text-[#7C3AED]/60">
                                  ({inv.members.filter(m => m.enrolments.length >= 2).map(m => `${m.full_name.split(' ')[0]}: ${m.enrolments.length}`).join(', ')})
                                </span>
                              </span>
                              <span className="tabular-nums">−${Number(inv.multi_course_discount).toLocaleString()}</span>
                            </div>
                          )}
                          {/* Applied credits */}
                          {(inv.credits || []).map((c, i) => (
                            <div key={i} className="flex justify-between text-xs text-[#0F766E]">
                              <span className="truncate">
                                {CREDIT_REASON_LABELS[c.reason] || c.reason}
                                {c.notes ? <span className="text-[#0F766E]/60 ml-1">· {c.notes}</span> : null}
                              </span>
                              <span className="tabular-nums shrink-0 ml-2">−${Number(c.amount).toLocaleString()}</span>
                            </div>
                          ))}
                          <div className="flex justify-between items-center pt-1.5 mt-0.5 border-t border-[#E8EDF8]">
                            <span className="text-sm font-bold text-[#062E63]">Total</span>
                            <span className="text-sm font-bold text-[#062E63] tabular-nums">${Number(inv.adjustedTotal ?? inv.total).toLocaleString()}</span>
                          </div>
                          {/* Pending credits notice */}
                          {inv.pendingTotal > 0 && (
                            <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] px-2.5 py-1.5">
                              <span className="text-[10px] text-[#92400E] font-medium">
                                ${inv.pendingTotal} pending credit{inv.pendingCredits.length > 1 ? 's' : ''} available
                              </span>
                              <button
                                onClick={() => handleApplyPending(inv)}
                                className="text-[10px] font-bold text-[#92400E] underline hover:no-underline"
                              >Apply</button>
                            </div>
                          )}
                        </div>
                        {/* Action buttons */}
                        <div className="px-5 pb-4 flex flex-col gap-2">
                          <button
                            onClick={() => setCreditModal({ invoiceId: inv.id, members: inv.members })}
                            className="w-full text-[11px] font-semibold text-[#325099] border border-dashed border-[#BACBFF] rounded-lg py-1.5 hover:bg-[#F0F4FF] transition"
                          >
                            + Add credit
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Delete invoice for ${inv.displayName}? This cannot be undone.`)) return
                              const { error } = await supabase.from(T_INVOICES).delete().eq('id', inv.id)
                              if (error) alert(`Delete failed: ${error.message}`)
                              else setReloadKey(k => k + 1)
                            }}
                            className="w-full text-[11px] font-semibold text-red-400 border border-dashed border-red-200 rounded-lg py-1.5 hover:bg-red-50 transition"
                          >
                            Delete invoice
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                </div>
              )
            ) : selectedTable === T_LESSONS && lessonViewMode === 'level_tests' ? (
              loading ? (
                <div className="flex items-center justify-center h-full"><p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p></div>
              ) : (
                <LevelTestsView rows={rows.filter(r => r.lesson_type === 'level_test')} onOpen={(lid) => router.push(`/tutor/lessons/${lid}`)} onDelete={handleDeleteLevelTest} />
              )
            ) : (selectedTable === T_PARENTS && guardianViewMode === 'families') ? null
            : (selectedTable === T_STUDENTS && studentViewMode === 'cards') ? null
            : loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p>
              </div>
            ) : tableError ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
                <p className="text-4xl">🔒</p>
                <p className="text-sm font-semibold text-[#2A2035]">Cannot load table</p>
                <p className="text-xs text-[#2A2035]/50 max-w-xs">{tableError}</p>
                <p className="text-[10px] text-[#2A2035]/35">This may be an RLS policy restriction.</p>
              </div>
            ) : columnOrder.length === 0 && !addingRow ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="text-4xl">📭</p>
                <p className="text-sm font-semibold text-[#2A2035]">No rows yet</p>
                <button onClick={selectedTable === 'classes' ? openAddClassModal : selectedTable === T_ENROLMENTS ? () => setShowAddEnrolmentModal(true) : selectedTable === T_COURSES ? openAddCourseModal : () => setAddingRow(true)} className="px-4 py-2 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition">{selectedTable === 'classes' ? '+ Add Class' : selectedTable === T_ENROLMENTS ? '+ Add Enrolment' : selectedTable === T_COURSES ? '+ Add Course' : '+ Add first row'}</button>
              </div>
            ) : (
              <table className="text-xs border-separate border-spacing-0" style={{ tableLayout:'fixed', minWidth:'max-content' }}>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-30 bg-[#EEF1F8] border-b-2 border-r border-[#DEE7FF] text-center text-[10px] font-bold text-[#325099]/40 select-none" style={{ width:42, minWidth:42, left:0 }}>#</th>

                    {columnOrder.filter(col => !hiddenCols.has(col)).map(col => {
                      const isPk          = col === pkCol
                      const isGuardian    = isGuardianCol(col)
                      const isName        = isNameCol(col)
                      const isDragTarget  = dragOver === col
                      const isColRenaming = renamingCol === col
                      const canRenameCol  = !isPk && !isGuardian && !isName
                      const w = columnWidths[col] ?? defaultWidth(col)

                      const stickyLeft = stickyColOffsets[col]
                      const isStickyCol = stickyLeft !== undefined

                      return (
                        <th
                          key={col}
                          draggable={!isColRenaming}
                          onDragStart={e => !isColRenaming && handleDragStart(e, col)}
                          onDragOver={e  => !isColRenaming && handleDragOver(e, col)}
                          onDragLeave={!isColRenaming ? handleDragLeave : undefined}
                          onDrop={e      => !isColRenaming && handleDrop(e, col)}
                          onDragEnd={!isColRenaming ? handleDragEnd : undefined}
                          onContextMenu={e => !isColRenaming && handleColContextMenu(e, col)}
                          onDoubleClick={() => !isColRenaming && !isPk && hideCol(col)}
                          className={`sticky top-0 border-b-2 border-r border-[#DEE7FF] text-left select-none transition-colors ${
                            isStickyCol ? 'z-30' : 'z-20'
                          } ${
                            isColRenaming ? 'bg-[#EEF4FF] border-b-[#325099]'
                            : isDragTarget ? 'bg-[#BACBFF] border-l-2 border-l-[#325099]'
                            : isGuardian   ? 'bg-[#FEF9EC]'
                            : isName       ? 'bg-[#ECFDF5]'
                            : 'bg-[#EEF1F8]'
                          }`}
                          style={{
                            width:w, minWidth:w, maxWidth:w,
                            cursor: isColRenaming ? 'default' : 'grab',
                            ...(isStickyCol ? { position:'sticky', left: stickyLeft, boxShadow: col === 'full_name' ? '2px 0 4px -1px rgba(0,0,0,0.08)' : 'none' } : {}),
                          }}
                        >
                          {isColRenaming ? (
                            <div className="px-1.5 py-1.5 flex flex-col gap-0.5">
                              <div className="flex items-center gap-1">
                                <input
                                  ref={renameColInputRef}
                                  type="text"
                                  value={renameColValue}
                                  onChange={e => setRenameColValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_'))}
                                  onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); commitColRename() } if (e.key==='Escape') cancelColRename() }}
                                  disabled={renameColWorking}
                                  className={`flex-1 min-w-0 px-1.5 py-1 rounded text-[10px] font-mono bg-white border focus:outline-none disabled:opacity-50 ${renameColError ? 'border-red-400' : 'border-[#325099]'} text-[#2A2035]`}
                                />
                                <button onClick={commitColRename} disabled={renameColWorking} title="Confirm" className="w-5 h-5 flex items-center justify-center rounded bg-[#325099] text-white text-[9px] hover:bg-[#062E63] transition disabled:opacity-40 shrink-0">{renameColWorking ? '…' : '✓'}</button>
                                <button onClick={cancelColRename} title="Cancel" className="w-5 h-5 flex items-center justify-center rounded text-[#2A2035]/40 hover:text-[#2A2035] hover:bg-[#DEE7FF] transition text-xs shrink-0">✕</button>
                              </div>
                              {renameColError && <p className="text-[8px] text-red-500 leading-tight px-0.5 truncate" title={renameColError}>{renameColError}</p>}
                            </div>
                          ) : (
                            <div className="flex items-center px-3 py-2.5 overflow-hidden gap-1" title={columnTooltip(VIRTUAL[selectedTable]?.realTable ?? selectedTable, col)}>
                              {isPk       && <span className="text-[9px] text-amber-500 shrink-0">🔑</span>}
                              {isGuardian && <span className="text-[9px] text-amber-600/70 shrink-0">👤</span>}
                              {isName     && <span className="text-[9px] text-emerald-600/70 shrink-0">🔗</span>}
                              <span className={`text-[10px] font-bold tracking-[0.06em] uppercase truncate flex-1 min-w-0 ${isName ? 'text-emerald-800' : 'text-[#062E63]'}`}>
                                {columnLabel(VIRTUAL[selectedTable]?.realTable ?? selectedTable, col)}
                                {isRequired(VIRTUAL[selectedTable]?.realTable ?? selectedTable, col) && <span className="text-rose-400 ml-0.5">*</span>}
                              </span>
                              {/* Resize handle */}
                              <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#325099]/30 active:bg-[#325099]/50 transition-colors" onMouseDown={e => handleResizeStart(e, col)} onDragStart={e => e.preventDefault()} />
                            </div>
                          )}
                        </th>
                      )
                    })}

                    {/* Enrolments column — classes table only */}
                    {selectedTable === 'classes' && (
                      <th className="sticky top-0 z-20 bg-[#EEF1F8] border-b-2 border-r border-[#DEE7FF] select-none" style={{ width: 300, minWidth: 300 }}>
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <span className="text-[10px] font-bold text-[#062E63] tracking-[0.06em] uppercase">Students</span>
                          <span className="text-[9px] text-[#325099]/40 font-normal normal-case tracking-normal">enrolled</span>
                        </div>
                      </th>
                    )}

                    {/* Siblings column — students table only */}
                    {selectedTable === 'students' && (
                      <th className="sticky top-0 z-20 bg-[#EEF1F8] border-b-2 border-r border-[#DEE7FF] select-none" style={{ width: 260, minWidth: 260 }}>
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <span className="text-[10px] font-bold text-[#062E63] tracking-[0.06em] uppercase">Siblings</span>
                          <span className="text-[9px] text-[#325099]/40 font-normal normal-case tracking-normal">family group</span>
                        </div>
                      </th>
                    )}

                    <th className="sticky top-0 z-20 bg-[#EEF1F8] border-b-2 border-[#DEE7FF]" style={{ width:56, minWidth:56 }} />
                  </tr>
                </thead>

                <tbody>
                  {addingRow && (
                    <tr className="bg-[#F0FDF4]">
                      <td className="border-b border-r border-[#DEE7FF] px-2 py-2 text-center text-[#065F46] font-bold">*</td>
                      {columnOrder.filter(col => !hiddenCols.has(col)).map(col => {
                        const w = columnWidths[col] ?? defaultWidth(col)
                        const defVal = vConfig?.defaultRow?.[col] ?? ''
                        return (
                          <td key={col} className="border-b border-r border-[#A7F3D0] p-0" style={{ width:w, maxWidth:w }}>
                            {col === pkCol ? (
                              <span className="block px-3 py-2 text-[#2A2035]/30 italic text-[10px]">auto</span>
                            ) : ENROLMENT_NAME_COLS.includes(col) || col === COURSE_NAME_COL || col === TERM_NAME_COL ? (
                              <span className="block px-3 py-2 text-emerald-600/40 italic text-[10px]">auto-resolved</span>
                            ) : col === LESSON_CLASS_COL || col === LESSON_WEEK_COL || col === LESSON_MAIN_TEACHER_COL || col === LESSON_SCHED_TEACHER_COL ? (
                              <span className="block px-3 py-2 text-emerald-600/40 italic text-[10px]">auto</span>
                            ) : (
                              <input type="text" placeholder={defVal || col} value={newRowData[col] ?? defVal} onChange={e => setNewRowData(p => ({ ...p, [col]:e.target.value }))} onKeyDown={e => { if (e.key==='Enter') handleAddRow(); if (e.key==='Escape') { setAddingRow(false); setNewRowData({}) } }} className="w-full px-3 py-2 bg-transparent text-[#2A2035] placeholder-[#2A2035]/25 focus:outline-none focus:bg-[#DCFCE7]" />
                            )}
                          </td>
                        )
                      })}
                      {selectedTable === 'classes' && (
                        <td className="border-b border-r border-[#A7F3D0] p-0" style={{ width: 300 }}>
                          <span className="block px-3 py-2 text-[#2A2035]/25 italic text-[10px]">save first, then enrol</span>
                        </td>
                      )}
                      <td className="border-b border-[#A7F3D0] px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button onClick={handleAddRow} disabled={addingSaving} className="px-2 py-1 bg-[#065F46] text-white text-[10px] font-bold rounded-md hover:bg-[#047857] transition disabled:opacity-50">{addingSaving ? '…' : '✓'}</button>
                          <button onClick={() => { setAddingRow(false); setNewRowData({}) }} className="px-2 py-1 bg-[#F4F4F4] text-[#9CA3AF] text-[10px] font-bold rounded-md hover:bg-[#E5E7EB] transition">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {filteredRows.map((row, ri) => {
                    const rowId     = pkCol ? row[pkCol] : ri
                    const isConfirm = deleteConfirm === rowId
                    const rowBg     = ri % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'

                    return (
                      <tr key={String(rowId)} className={`group ${rowBg} hover:bg-[#F0F4FF] transition-colors`}>
                        <td className="border-b border-r border-[#E8EDF8] px-2 py-1.5 text-center text-[#2A2035]/25 font-mono text-[10px] select-none" style={{ width:42, position:'sticky', left:0, zIndex:2, background: ri % 2 === 0 ? '#ffffff' : '#F9FAFB' }}>
                          {selectedTable === T_LESSONS ? (
                            <button
                              title="Open lesson details"
                              onClick={() => openLessonSidebar(row)}
                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#DEE7FF] text-[#325099]/40 hover:text-[#325099] transition text-[11px]"
                            >⊞</button>
                          ) : pkCol ? (
                            <>
                              <span className="group-hover:hidden">{ri + 1}</span>
                              <button
                                title="Open record details"
                                onClick={() => openRowDetail(row)}
                                className="hidden group-hover:flex w-5 h-5 mx-auto items-center justify-center rounded hover:bg-[#DEE7FF] text-[#325099]/40 hover:text-[#325099] transition text-[11px]"
                              >⊞</button>
                            </>
                          ) : ri + 1}
                        </td>

                        {columnOrder.filter(col => !hiddenCols.has(col)).map(col => {
                          const val       = row[col]
                          const isEditing = editingCell?.rowId === rowId && editingCell?.col === col
                          const isPk      = col === pkCol
                          const isGuardian = isGuardianCol(col)
                          const isName    = isNameCol(col)
                          const dv        = displayVal(val)
                          const truncated = dv !== null && dv.length > 50
                          const w         = columnWidths[col] ?? defaultWidth(col)
                          const stickyLeft = stickyColOffsets[col]
                          const isStickyCol = stickyLeft !== undefined

                          // Sticky cells must have a fully opaque background so scrolled columns
                          // don't bleed through. Use the same even/odd row colours as the row bg.
                          const baseBg = ri % 2 === 0 ? '#ffffff' : '#F9FAFB'
                          const stickyBg = isPk ? (ri % 2 === 0 ? '#F4F7FF' : '#EFF3FF')
                                         : isName ? (ri % 2 === 0 ? '#F0FDF4' : '#E8FAF0')
                                         : baseBg

                          // Derive week from lesson_date when the stored week is blank
                          // (makeups + ad-hoc/added lessons), so the week always matches the date.
                          const isMakeupRow = selectedTable === T_LESSONS && row.is_makeup
                          let makeupWeek = dv
                          if (col === LESSON_WEEK_COL && selectedTable === T_LESSONS && (makeupWeek === null || makeupWeek === '') && row.lesson_date && allTerms?.length) {
                            const ld = new Date(row.lesson_date + 'T00:00:00')
                            for (const t of allTerms) {
                              if (!t.start_date || !t.end_date) continue
                              const ts = new Date(t.start_date + 'T00:00:00')
                              const te = new Date(t.end_date + 'T00:00:00')
                              if (ld >= ts && ld <= te) {
                                makeupWeek = Math.floor((ld - ts) / (7 * 86400000)) + 1
                                break
                              }
                            }
                          }

                          return (
                            <td key={col} className={`border-b border-r border-[#E8EDF8] p-0 ${!isStickyCol && isPk ? 'bg-[#F8FAFF]/60' : !isStickyCol && isGuardian ? 'bg-[#FFFBEB]/40' : !isStickyCol && isName ? 'bg-[#F0FDF4]/60' : ''}`} style={{ width:w, maxWidth:w, ...(isStickyCol ? { position:'sticky', left: stickyLeft, zIndex: 2, background: stickyBg, boxShadow: col === 'full_name' ? '2px 0 4px -1px rgba(0,0,0,0.06)' : 'none' } : {}) }} onClick={() => !isPk && !isName && handleCellClick(rowId, col, val)}>
                              {col === LESSON_SCHED_TEACHER_COL ? (
                                // Editable dropdown for scheduled teacher
                                editingSchedTeacher === rowId ? (
                                  <select
                                    autoFocus
                                    defaultValue={row.scheduled_teacher_id || ''}
                                    onBlur={() => setEditingSchedTeacher(null)}
                                    onChange={async e => {
                                      const newId = e.target.value || null
                                      // Write UUID to scheduled_teacher_id, update display name
                                      await supabase.from(T_LESSONS).update({ scheduled_teacher_id: newId }).eq('id', rowId)
                                      const newName = newId ? (allStaffForLessons.find(s => s.id === newId)?.full_name ?? null) : null
                                      setRows(prev => prev.map(r => r[pkCol] === rowId
                                        ? { ...r, scheduled_teacher_id: newId, [LESSON_SCHED_TEACHER_COL]: newName }
                                        : r
                                      ))
                                      setEditingSchedTeacher(null)
                                    }}
                                    className="w-full px-2 py-1.5 bg-[#EEF4FF] border-2 border-[#325099] text-[#2A2035] text-xs focus:outline-none"
                                    style={{ width: w }}
                                  >
                                    <option value="">— unassigned —</option>
                                    {allStaffForLessons.map(s => (
                                      <option key={s.id} value={s.id}>{s.full_name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div
                                    className="px-3 py-1.5 overflow-hidden whitespace-nowrap text-xs cursor-pointer hover:bg-[#EEF4FF] transition-colors"
                                    onClick={() => setEditingSchedTeacher(rowId)}
                                    title="Click to change scheduled teacher"
                                  >
                                    {dv === null
                                      ? <span className="text-[#2A2035]/20 italic">unassigned</span>
                                      : <span className={row.scheduled_teacher_id && row.main_teacher && dv !== row.main_teacher ? 'font-semibold text-[#92400E]' : 'text-[#2A2035]'}>{dv}</span>
                                    }
                                    {row.scheduled_teacher_id && row.main_teacher && dv !== row.main_teacher && (
                                      <span className="ml-1 text-[9px] text-[#F59E0B]">↻ sub</span>
                                    )}
                                  </div>
                                )
                              ) : isEditing ? (() => {
                                const mTbl = metaTableFor(col)
                                const mCol = metaColFor(col)
                                const ek   = fieldEditorKind(mTbl, mCol)
                                // Linked record → searchable picker (only ever returns an existing id)
                                if (ek === 'linked') {
                                  const ref = linkedRef(mTbl, mCol)
                                  if (ref) return (
                                    <div className="relative" style={{ width: w, minHeight: 30 }}>
                                      <LinkedRecordPicker
                                        value={editValue}
                                        options={refData.options(ref.refTable)}
                                        width={w}
                                        onPick={(id) => handleDropdownSave(id === null || id === undefined ? '' : String(id))}
                                        onCancel={() => setEditingCell(null)}
                                      />
                                    </div>
                                  )
                                }
                                // Date → native date picker (only when value is blank or ISO date)
                                if (ek === 'date' && (editValue === '' || /^\d{4}-\d{2}-\d{2}$/.test(editValue))) return (
                                  <input ref={editInputRef} type="date" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={handleCellSave} onKeyDown={handleCellKeyDown} className="w-full px-2 py-1.5 bg-[#EEF4FF] border-2 border-[#325099] text-[#2A2035] focus:outline-none text-xs" style={{ width:w }} />
                                )
                                // Single-select dropdown (metadata, dynamic ref list, or legacy map)
                                if (cellDropdownFor(selectedTable, col)) return (
                                  <select ref={editInputRef} value={editValue} onChange={e => handleDropdownSave(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null) }} className="w-full px-2 py-1.5 bg-[#EEF4FF] border-2 border-[#325099] text-[#2A2035] focus:outline-none text-xs cursor-pointer" style={{ width:w }}>
                                    <option value="">—</option>
                                    {/* keep the current (possibly legacy) value selectable so old rows still save */}
                                    {editValue && !cellDropdownFor(selectedTable, col).includes(editValue) && <option value={editValue}>{editValue} (legacy)</option>}
                                    {cellDropdownFor(selectedTable, col).map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                )
                                // Plain text / number fallback
                                return (
                                  <input ref={editInputRef} type="text" inputMode={ek === 'number' || ek === 'currency' || ek === 'percent' ? 'decimal' : undefined} value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={handleCellSave} onKeyDown={handleCellKeyDown} className="w-full px-3 py-1.5 bg-[#EEF4FF] border-2 border-[#325099] text-[#2A2035] focus:outline-none text-xs" style={{ width:w }} />
                                )
                              })() : col === LESSON_WEEK_COL ? (
                                <div className="px-2 py-1.5 text-center">
                                  {makeupWeek === null
                                    ? <span className="text-[#2A2035]/20 italic text-[10px]">—</span>
                                    : isMakeupRow
                                      ? <span className="inline-block text-[10px] font-bold tabular-nums bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] px-1.5 py-0.5 rounded-full">Wk {makeupWeek}</span>
                                      : <span className="inline-block text-[10px] font-bold tabular-nums bg-[#DEE7FF] text-[#062E63] px-1.5 py-0.5 rounded-full">Wk {makeupWeek}</span>
                                  }
                                </div>

                              ) : (() => {
                                const mTbl = metaTableFor(col)
                                const mCol = metaColFor(col)
                                // Linked record → resolved, clickable name badge (instead of a raw id)
                                const ref = linkedRef(mTbl, mCol)
                                if (ref) return (
                                  <div className="px-3 py-1.5 overflow-hidden whitespace-nowrap">
                                    <LinkedRecordBadge value={val} refTable={ref.refTable} resolve={refData.resolve} onOpen={openLinkedDetail} compact />
                                  </div>
                                )
                                if (dv === null) return (
                                  <div className="px-3 py-1.5 text-[#2A2035]/20 italic text-[10px]">null</div>
                                )
                                const ftype = fieldType(mTbl, mCol)
                                // Hardcoded status colours first, then metadata-driven formatting
                                const badgeClass = CELL_BADGE_COLORS[`${selectedTable}:${col}`]?.[dv]
                                if (badgeClass) return (
                                  <div className="px-3 py-1.5 cursor-text">
                                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>{dv}</span>
                                  </div>
                                )
                                if (ftype === 'boolean') {
                                  const on = dv === 'true'
                                  if (selectedTable === T_TUTORS && col === 'active') {
                                    return <div className="px-3 py-1.5"><span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${on ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>{on ? 'Active' : 'Inactive'}</span></div>
                                  }
                                  return <div className="px-3 py-1.5"><span className={`inline-flex items-center gap-1 text-[11px] font-medium ${on ? 'text-emerald-700' : 'text-[#2A2035]/45'}`}>{on ? '☑ Yes' : '☐ No'}</span></div>
                                }
                                if (ftype === 'email') return (
                                  <div className="px-3 py-1.5 overflow-hidden whitespace-nowrap"><a href={`mailto:${dv}`} onClick={e => e.stopPropagation()} className="text-[#325099] hover:underline text-xs">{dv}</a></div>
                                )
                                if (ftype === 'url') {
                                  const href = /^https?:\/\//.test(dv) ? dv : `https://${dv}`
                                  return <div className="px-3 py-1.5 overflow-hidden whitespace-nowrap"><a href={href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[#325099] hover:underline text-xs">{dv} ↗</a></div>
                                }
                                if (ftype === 'currency' || ftype === 'percent' || ftype === 'date' || ftype === 'datetime') return (
                                  <div className="px-3 py-1.5 overflow-hidden whitespace-nowrap text-xs text-[#2A2035] tabular-nums" title={dv}>{formatDisplay(mTbl, mCol, val)}</div>
                                )
                                if (dropdownOptions(mTbl, mCol)) return (
                                  <div className="px-3 py-1.5"><span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">{dv}</span></div>
                                )
                                return (
                                  <div className={`px-3 py-1.5 overflow-hidden whitespace-nowrap ${isPk ? 'text-[#325099]/60 font-mono text-[10px]' : isGuardian ? 'text-[#92400E]/80 text-xs' : isName ? 'text-emerald-800 text-xs font-medium' : 'text-[#2A2035] text-xs'} ${!isPk && !isName ? 'cursor-text' : 'cursor-default'}`} title={truncated ? dv : undefined}>
                                    {truncated ? dv.slice(0,50)+'…' : dv}
                                  </div>
                                )
                              })()
                              }
                            </td>
                          )
                        })}

                        {/* Enrolments cell — classes table only */}
                        {selectedTable === 'classes' && (
                          <td className="border-b border-r border-[#E8EDF8] p-0 align-top" style={{ width: 300, minWidth: 300 }}>
                            <div className="px-2 py-1.5 flex flex-wrap gap-1 items-center min-h-[34px]">
                              {(enrolmentMap[rowId] || []).map(s => (
                                <span key={s.id} className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-[#DEE7FF] text-[#062E63] px-2 py-0.5 rounded-full whitespace-nowrap">
                                  {s.full_name}
                                  <button
                                    onClick={e => { e.stopPropagation(); handleUnenrol(rowId, s.id) }}
                                    className="ml-0.5 text-[#062E63]/40 hover:text-red-500 transition leading-none"
                                    title={`Remove ${s.full_name}`}
                                  >×</button>
                                </span>
                              ))}
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setEnrolPopover({ classId: rowId, x: rect.left, y: rect.bottom + 4 })
                                }}
                                className="w-5 h-5 flex items-center justify-center rounded-full bg-[#F0F4FF] border border-[#DEE7FF] text-[#325099] hover:bg-[#DEE7FF] transition text-sm leading-none shrink-0"
                                title="Add student"
                              >+</button>
                            </div>
                          </td>
                        )}

                        {/* Siblings cell — students table only */}
                        {selectedTable === 'students' && (
                          <td className="border-b border-r border-[#E8EDF8] p-0 align-top" style={{ width: 260, minWidth: 260 }}>
                            <div className="px-2 py-1.5 flex flex-wrap gap-1 items-center min-h-[34px]">
                              {(siblingMap[rowId] || []).map(s => (
                                <span key={s.id} className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] px-2 py-0.5 rounded-full whitespace-nowrap">
                                  {s.full_name}
                                  <button
                                    onClick={e => { e.stopPropagation(); handleRemoveSibling(s.id) }}
                                    className="ml-0.5 text-[#92400E]/40 hover:text-red-500 transition leading-none"
                                    title={`Unlink ${s.full_name} from family`}
                                  >×</button>
                                </span>
                              ))}
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setSiblingPopover({ studentId: rowId, x: rect.left, y: rect.bottom + 4 })
                                }}
                                className="w-5 h-5 flex items-center justify-center rounded-full bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] hover:bg-[#FEF3C7] transition text-sm leading-none shrink-0"
                                title="Add sibling"
                              >+</button>
                            </div>
                          </td>
                        )}

                        {/* Cancel button — lessons only */}
                        {selectedTable === T_LESSONS && (
                          <td className="border-b border-r border-[#E8EDF8] px-1 py-1" style={{ width: 70 }}>
                            {(lessonCancellations[rowId] || []).length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {(lessonCancellations[rowId] || []).map(c => (
                                  <div key={c.id} className="flex items-center gap-1">
                                    <span className="text-[9px] font-semibold bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                      ✕ {c.students?.full_name?.split(' ')[0]}
                                    </span>
                                    <button
                                      onClick={() => {
                                        if (!confirm('Undo this cancellation?')) return
                                        authedFetch('/api/undo-cancellation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancellation_id: c.id }) })
                                          .then(() => setLessonCancellations(prev => {
                                            const updated = (prev[rowId] || []).filter(x => x.id !== c.id)
                                            return { ...prev, [rowId]: updated }
                                          }))
                                      }}
                                      className="text-[9px] text-gray-400 hover:text-red-500 transition"
                                      title="Undo cancellation"
                                    >↩</button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); setCancelModal({ row }) }}
                                className="opacity-0 group-hover:opacity-100 text-[9px] font-semibold text-orange-600 border border-orange-200 bg-orange-50 hover:bg-orange-100 px-1.5 py-0.5 rounded transition whitespace-nowrap"
                                title="Cancel lesson for a student"
                              >Cancel</button>
                            )}
                          </td>
                        )}

                        <td className="border-b border-[#E8EDF8] px-1.5 py-1" style={{ width:56 }}>
                          {isConfirm ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDeleteRow(rowId)} className="px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded hover:bg-red-600 transition">Delete</button>
                              <button onClick={() => setDeleteConfirm(null)} className="px-1.5 py-0.5 bg-[#F4F4F4] text-[#9CA3AF] text-[9px] rounded">Cancel</button>
                            </div>
                          ) : (
                            pkCol && <button onClick={() => { setDeleteConfirm(rowId); setEditingCell(null) }} className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[#2A2035]/25 hover:text-red-500 hover:bg-red-50 transition" title="Delete row">×</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  {filteredRows.length === 0 && !addingRow && rows.length > 0 && (
                    <tr><td colSpan={columnOrder.filter(c => !hiddenCols.has(c)).length + 2} className="px-4 py-10 text-center text-xs text-[#2A2035]/40">No rows match &ldquo;{search}&rdquo;</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-5 py-2 bg-[#F8FAFF] border-t border-[#DEE7FF] text-[10px] text-[#2A2035]/35 shrink-0 select-none">
            <span>{search ? `${filteredRows.length} of ${rows.length} rows match` : `${rows.length} rows loaded`}{rows.length >= 500 && ' · first 500 only'}</span>
            <span>
              {columnOrder.length > 0 && `${columnOrder.length} columns`}
              {pkCol && ` · pk: ${pkCol}`}
              {saving && ' · saving…'}
              {undoStack.length > 0 && ` · ${undoStack.length} undo${undoStack.length > 1 ? 's' : ''}`}
            </span>
          </div>
        </main>
      </div>

      {/* ── Airtable-style record detail panel (linked records) ─────────────── */}
      {detailRecord && (
        <RecordDetailPanel
          key={`${detailRecord.realTable}:${detailRecord.row?.id}`}
          initial={detailRecord}
          resolve={refData.resolve}
          onClose={() => setDetailRecord(null)}
        />
      )}

      {/* ── Lesson Detail Sidebar ───────────────────────────────────────────── */}
      {lessonSidebar && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={closeLessonSidebar} />
          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-[420px] max-w-full z-50 bg-white shadow-2xl flex flex-col border-l border-[#DEE7FF] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#DEE7FF] bg-gradient-to-r from-[#F8FAFF] to-[#EEF4FF] flex items-start justify-between gap-3 shrink-0">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099]/60 mb-0.5">Lesson Details</p>
                <h2 className="text-base font-bold text-[#062E63]">
                  {lessonSidebar[LESSON_CLASS_COL] || `Class ${lessonSidebar.class_id}`}
                </h2>
                <p className="text-xs text-[#2A2035]/50 mt-0.5">
                  {lessonSidebar.lesson_date}
                  {lessonSidebar.start_time && ` · ${lessonSidebar.start_time}`}
                  {lessonSidebar.end_time && `–${lessonSidebar.end_time}`}
                  {lessonSidebar.room && ` · ${lessonSidebar.room}`}
                </p>
                {lessonSidebar[LESSON_SCHED_TEACHER_COL] && (
                  <p className="text-xs text-[#325099] mt-0.5 font-medium">👤 {lessonSidebar[LESSON_SCHED_TEACHER_COL]}</p>
                )}
                {lessonSidebar.week && (
                  <span className="inline-block mt-1 text-[10px] font-bold tracking-widest uppercase bg-[#DEE7FF] text-[#325099] px-2 py-0.5 rounded-full">Week {lessonSidebar.week}</span>
                )}
              </div>
              <button onClick={closeLessonSidebar} className="w-7 h-7 flex items-center justify-center rounded-full text-[#2A2035]/40 hover:bg-[#F0F4FF] text-lg transition shrink-0">×</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {sidebarLoading ? (
                <p className="text-xs text-[#325099] animate-pulse text-center py-10">Loading…</p>
              ) : !sidebarData ? null : makeupStudent ? (
                /* ── Makeup flow ── */
                <div>
                  <button onClick={() => { setMakeupStudent(null); setMakeupMode(null) }} className="text-[11px] text-[#325099] hover:underline mb-3 flex items-center gap-1">← Back</button>
                  <div className="bg-[#F8FAFF] rounded-xl border border-[#DEE7FF] px-4 py-3 mb-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#062E63] text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {(makeupStudent.full_name || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#062E63]">{makeupStudent.full_name}</p>
                      <p className="text-[11px] text-[#2A2035]/50">Y{makeupStudent.year} · {makeupStudent.school || '—'}</p>
                    </div>
                  </div>

                  {!makeupMode ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[#2A2035]/60 mb-3">Choose action:</p>
                      <button onClick={() => openMakeupMove(lessonSidebar)}
                        className="w-full text-left px-4 py-3 rounded-xl border border-[#DEE7FF] hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition">
                        <p className="text-sm font-bold text-[#062E63]">📅 Move to another session</p>
                        <p className="text-xs text-[#2A2035]/50 mt-0.5">Student attends an upcoming session of the same or related class</p>
                      </button>
                      <button onClick={() => setMakeupMode('onetoone')}
                        className="w-full text-left px-4 py-3 rounded-xl border border-[#DEE7FF] hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition">
                        <p className="text-sm font-bold text-[#062E63]">👤 Create 1:1 makeup lesson</p>
                        <p className="text-xs text-[#2A2035]/50 mt-0.5">Schedule a private session just for this student with a chosen tutor</p>
                      </button>
                      <button onClick={() => openCancelFlow(makeupStudent, lessonSidebar)}
                        className="w-full text-left px-4 py-3 rounded-xl border border-red-100 hover:border-red-300 hover:bg-red-50 transition">
                        <p className="text-sm font-bold text-red-700">✕ Cancel this lesson</p>
                        <p className="text-xs text-red-500/70 mt-0.5">Mark as cancelled with or without a credit applied to their invoice</p>
                      </button>
                    </div>
                  ) : makeupMode === 'cancel' ? (
                    <div className="space-y-4">
                      <p className="text-xs font-semibold text-[#2A2035]/60 uppercase tracking-wide">Cancellation type</p>
                      <div className="flex gap-2">
                        {[
                          { id: 'credit',     label: 'Credit',      desc: 'Student notified us beforehand' },
                          { id: 'non_credit', label: 'Non-credit',   desc: 'No-show without notice' },
                        ].map(t => (
                          <button key={t.id} onClick={() => setCancelType(t.id)}
                            className={`flex-1 text-left px-3 py-2.5 rounded-xl border transition text-xs ${cancelType === t.id ? 'border-[#325099] bg-[#F0F4FF]' : 'border-[#DEE7FF] hover:border-[#325099]/40'}`}>
                            <p className={`font-semibold ${cancelType === t.id ? 'text-[#062E63]' : 'text-[#325099]/70'}`}>{t.label}</p>
                            <p className="text-[10px] text-[#325099]/40 mt-0.5">{t.desc}</p>
                          </button>
                        ))}
                      </div>
                      {cancelType === 'credit' && cancelCredit && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs">
                          <p className="font-semibold text-emerald-800">Credit: ${cancelCredit.amount.toFixed(2)}</p>
                          <p className="text-emerald-600 text-[11px] mt-0.5">${cancelCredit.enrolment_price} ÷ 10 weeks · applied to current or next invoice</p>
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-widest mb-1">Reason <span className="font-normal normal-case text-[#325099]/40">(optional)</span></label>
                        <input type="text" value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                          placeholder="e.g. Sick, family holiday…"
                          className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white" />
                      </div>
                      <button onClick={handleCancelLesson} disabled={makeupSaving}
                        className="w-full py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition disabled:opacity-50">
                        {makeupSaving ? 'Cancelling…' : 'Confirm cancellation'}
                      </button>
                    </div>
                  ) : makeupMode === 'move' ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-[#325099]/70 uppercase tracking-wide">Sessions this week — same course</p>
                      {moveLoadingOpts ? (
                        <p className="text-xs text-[#325099] animate-pulse py-4 text-center">Loading sessions…</p>
                      ) : moveOptions.length === 0 ? (
                        <p className="text-xs text-[#2A2035]/50 py-4 text-center">No other sessions found for this course this week.</p>
                      ) : (
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                          {moveOptions.map(opt => (
                            <button key={opt.id} onClick={() => setMoveTargetId(opt.id)}
                              className={`w-full text-left px-3 py-2.5 rounded-xl border transition text-sm ${moveTargetId === opt.id ? 'border-[#325099] bg-[#EEF4FF]' : 'border-[#DEE7FF] hover:bg-[#F8FAFF]'}`}>
                              <p className="font-semibold text-[#062E63]">{opt.classes?.class_name || opt.class_id} · {opt.lesson_date}</p>
                              <p className="text-[11px] text-[#2A2035]/50">{opt.start_time}{opt.end_time ? `–${opt.end_time}` : ''}{opt.classes?.room ? ` · ${opt.classes.room}` : ''}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      <button onClick={saveMakeupMove} disabled={!moveTargetId || makeupSaving}
                        className="w-full py-2.5 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition disabled:opacity-50">
                        {makeupSaving ? 'Saving…' : 'Confirm move'}
                      </button>
                    </div>
                  ) : (
                    /* 1:1 makeup form */
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-[#325099]/70 uppercase tracking-wide">1:1 lesson details</p>
                      <div>
                        <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-widest mb-1">Tutor</label>
                        <select value={oneToOneTutorId} onChange={e => setOneToOneTutorId(e.target.value)}
                          className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white">
                          <option value="">— select tutor —</option>
                          {sidebarData.tutors.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-widest mb-1">Date <span className="text-red-400">*</span></label>
                        <input type="date" value={oneToOneDate} onChange={e => setOneToOneDate(e.target.value)}
                          className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-widest mb-1">Start time</label>
                          <input type="time" value={oneToOneStart} onChange={e => setOneToOneStart(e.target.value)}
                            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-widest mb-1">End time</label>
                          <input type="time" value={oneToOneEnd} onChange={e => setOneToOneEnd(e.target.value)}
                            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-widest mb-1">Room</label>
                        <input type="text" value={oneToOneRoom} onChange={e => setOneToOneRoom(e.target.value)} placeholder="e.g. Room 3"
                          className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white" />
                      </div>
                      <button onClick={saveMakeupOneToOne} disabled={!oneToOneDate || makeupSaving}
                        className="w-full py-2.5 bg-[#325099] text-white text-sm font-semibold rounded-xl hover:bg-[#062E63] transition disabled:opacity-50">
                        {makeupSaving ? 'Creating…' : 'Create 1:1 makeup lesson'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Student roster ── */
                <div>
                  <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099]/60 mb-3">
                    Students · {sidebarData.roster.length}
                  </p>
                  {sidebarData.roster.length === 0 ? (
                    <p className="text-xs text-[#2A2035]/40 text-center py-8">No students enrolled in this class.</p>
                  ) : (
                    <div className="space-y-2">
                      {sidebarData.roster.map(s => {
                        const att = sidebarData.attMap[s.id]
                        const statusColor = att?.status === 'present' ? { bg:'#D1FAE5', fg:'#065F46' }
                          : att?.status === 'late'    ? { bg:'#FEF3C7', fg:'#92400E' }
                          : att?.status === 'absent'  ? { bg:'#FEE2E2', fg:'#991B1B' }
                          : att?.status === 'makeup'  ? { bg:'#EDE9FE', fg:'#5B21B6' }
                          : { bg:'#F4F4F4', fg:'#9CA3AF' }
                        return (
                          <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition ${s.isMakeupGuest ? 'border-[#C4B5FD] bg-[#FAF5FF] hover:border-[#A78BFA]' : 'border-[#DEE7FF] bg-white hover:border-[#BACBFF]'}`}>
                            <div className={`w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 ${s.isMakeupGuest ? 'bg-[#7C3AED]' : 'bg-[#062E63]'}`}>
                              {(s.full_name || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-semibold text-[#2A2035] truncate">{s.full_name}</p>
                                {s.isMakeupGuest && (
                                  <span className="text-[9px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-[#8B5CF6]/15 text-[#5B21B6] shrink-0 whitespace-nowrap">Makeup guest</span>
                                )}
                              </div>
                              <p className="text-[10px] text-[#2A2035]/45">Y{s.year} · {s.school || '—'}</p>
                              {s.isMakeupGuest && att?.notes && (
                                <p className="text-[10px] text-[#5B21B6]/70 mt-0.5 truncate">{att.notes}</p>
                              )}
                            </div>
                            {att?.status && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: statusColor.bg, color: statusColor.fg }}>
                                {att.status[0].toUpperCase() + att.status.slice(1)}
                              </span>
                            )}
                            {!s.isMakeupGuest && att?.status !== 'cancelled' && (
                              <button
                                onClick={() => setMakeupStudent(s)}
                                className="text-[10px] font-semibold text-[#325099] border border-[#DEE7FF] px-2.5 py-1 rounded-full hover:bg-[#EEF4FF] hover:border-[#325099] transition shrink-0"
                              >Actions</button>
                            )}
                            {att?.status === 'cancelled' && (
                              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full shrink-0">✕ Cancelled</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Add Class Modal ─────────────────────────────────────────────────── */}
      {showAddClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowAddClassModal(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#DEE7FF] bg-gradient-to-r from-[#F8FAFF] to-[#EEF4FF]">
              <h2 className="text-base font-bold text-[#2A2035] font-display">Add Class</h2>
              <p className="text-xs text-[#2A2035]/50 mt-0.5">Creates a new class for the current term. Fill in teacher, room and times afterwards.</p>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Course */}
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Course <span className="text-red-400">*</span></label>
                <select
                  value={newClassForm.course_id}
                  onChange={e => setNewClassForm(p => ({ ...p, course_id: e.target.value }))}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                >
                  <option value="">Select a course…</option>
                  {coursesList.map(c => (
                    <option key={c.id} value={c.id}>{c.course_name} ({c.course_code})</option>
                  ))}
                </select>
              </div>

              {/* Day */}
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Day <span className="text-red-400">*</span></label>
                <select
                  value={newClassForm.day_of_week}
                  onChange={e => setNewClassForm(p => ({ ...p, day_of_week: e.target.value }))}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                >
                  <option value="">Select a day…</option>
                  {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Times */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Start time <span className="text-red-400">*</span></label>
                  <input
                    type="time"
                    value={newClassForm.start_time}
                    onChange={e => setNewClassForm(p => ({ ...p, start_time: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">End time <span className="text-red-400">*</span></label>
                  <input
                    type="time"
                    value={newClassForm.end_time}
                    onChange={e => setNewClassForm(p => ({ ...p, end_time: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                  />
                </div>
              </div>

              {/* Validation hint */}
              {(!newClassForm.course_id || !newClassForm.day_of_week || !newClassForm.start_time || !newClassForm.end_time) && (
                <p className="text-[11px] text-[#2A2035]/40">All fields are required.</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2">
              <button
                onClick={() => setShowAddClassModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 bg-white border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAddClass}
                disabled={addClassSaving || !newClassForm.course_id || !newClassForm.day_of_week || !newClassForm.start_time || !newClassForm.end_time}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {addClassSaving ? 'Adding…' : 'Add Class'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Add Lesson Modal ─────────────────────────────────────────────────── */}
      {showAddLessonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowAddLessonModal(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#DEE7FF] bg-gradient-to-r from-[#F8FAFF] to-[#EEF4FF]">
              <h2 className="text-base font-bold text-[#2A2035] font-display">{newLessonForm.lesson_type === 'class' ? 'Add Lesson' : 'Add Level Test'}</h2>
              <p className="text-xs text-[#2A2035]/50 mt-0.5">{newLessonForm.lesson_type === 'class' ? 'Adds a lesson for a class on a specific date.' : 'Adds a level test for a student. Open it later to mark and send the report.'}</p>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Student (first) — level tests are for one student */}
              {newLessonForm.lesson_type !== 'class' && (
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Student <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={newLessonForm.student_name}
                  onChange={e => setNewLessonForm(p => ({ ...p, student_name: e.target.value }))}
                  placeholder="Student name"
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                />
              </div>
              )}

              {/* Level tests — multi-select checkbox dropdown */}
              {newLessonForm.lesson_type === 'level_test' && (
                <div>
                  <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Level tests <span className="text-red-400">*</span></label>
                  <div className="relative">
                    <button type="button" onClick={() => setLtPickerOpen(o => !o)}
                      className="w-full flex items-center justify-between gap-2 border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]">
                      <span className={newLessonForm.level_test_build_ids.length ? 'text-[#2A2035]' : 'text-[#2A2035]/40'}>
                        {newLessonForm.level_test_build_ids.length ? `${newLessonForm.level_test_build_ids.length} test${newLessonForm.level_test_build_ids.length > 1 ? 's' : ''} selected` : 'Select level test(s)…'}
                      </span>
                      <span className="text-[#325099]/60 text-[10px]">▾</span>
                    </button>
                    {ltPickerOpen && (
                      <div className="absolute z-10 mt-1 w-full max-h-52 overflow-auto bg-white border border-[#DEE7FF] rounded-lg shadow-lg p-1">
                        {levelTestsForLessons.length === 0 ? (
                          <p className="text-[11px] text-[#2A2035]/40 px-2 py-2">No level tests yet — build one in Resources → Level Tests.</p>
                        ) : levelTestsForLessons.map(lt => {
                          const checked = newLessonForm.level_test_build_ids.includes(lt.id)
                          return (
                            <label key={lt.id} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[#F0F4FF] cursor-pointer">
                              <input type="checkbox" checked={checked} className="mt-0.5 accent-[#325099]"
                                onChange={() => setNewLessonForm(p => ({ ...p, level_test_build_ids: checked ? p.level_test_build_ids.filter(x => x !== lt.id) : [...p.level_test_build_ids, lt.id] }))} />
                              <span className="text-sm text-[#2A2035] leading-snug">{lt.title}{lt.year ? ` · Yr ${lt.year}` : ''}{lt.subject ? ` · ${lt.subject}` : ''}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {newLessonForm.level_test_build_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {newLessonForm.level_test_build_ids.map(id => {
                        const lt = levelTestsForLessons.find(x => x.id === id)
                        return (
                          <span key={id} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-[#EEF4FF] text-[#062E63] rounded-full pl-2.5 pr-1.5 py-0.5">
                            {lt?.title || 'Test'}
                            <button type="button" onClick={() => setNewLessonForm(p => ({ ...p, level_test_build_ids: p.level_test_build_ids.filter(x => x !== id) }))}
                              className="text-[#062E63]/50 hover:text-[#062E63]">✕</button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Class link (only for class lessons) */}
              {newLessonForm.lesson_type === 'class' && (
                <div>
                  <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Class <span className="text-red-400">*</span></label>
                  <select
                    value={newLessonForm.class_id}
                    onChange={e => pickLessonClass(e.target.value)}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                  >
                    <option value="">Select a class…</option>
                    {classesForLessons.map(c => (
                      <option key={c.id} value={c.id}>{c.label || c.class_name}{c.day_of_week ? ` (${c.day_of_week})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Date <span className="text-red-400">*</span></label>
                <input
                  type="date"
                  value={newLessonForm.lesson_date}
                  onChange={e => setNewLessonForm(p => ({ ...p, lesson_date: e.target.value }))}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                />
              </div>

              {/* Scheduled teacher — only for 1:1 lessons (classes use the class's teacher) */}
              {newLessonForm.lesson_type === 'one_on_one' && (
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Scheduled teacher <span className="text-red-400">*</span></label>
                <select
                  value={newLessonForm.teacher_id}
                  onChange={e => setNewLessonForm(p => ({ ...p, teacher_id: e.target.value }))}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                >
                  <option value="">Select a teacher…</option>
                  {allStaffForLessons.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              </div>
              )}

              {/* Time */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Start time <span className="text-red-400">*</span></label>
                  <input
                    type="time"
                    value={newLessonForm.start_time}
                    onChange={e => setNewLessonForm(p => ({ ...p, start_time: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">End time</label>
                  <input
                    type="time"
                    value={newLessonForm.end_time}
                    onChange={e => setNewLessonForm(p => ({ ...p, end_time: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Notes</label>
                <textarea
                  rows={2}
                  value={newLessonForm.notes}
                  onChange={e => setNewLessonForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional notes for this lesson…"
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white resize-y focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                />
              </div>

              {/* Room */}
              <div>
                <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">Room</label>
                <input
                  type="text"
                  value={newLessonForm.room}
                  onChange={e => setNewLessonForm(p => ({ ...p, room: e.target.value }))}
                  placeholder="e.g. Room 2"
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                />
              </div>

              {!lessonFormValid && (
                <p className="text-[11px] text-[#2A2035]/40">{newLessonForm.lesson_type === 'class' ? 'A class, date and start time are required.' : `Date, student, start time and ${newLessonForm.lesson_type === 'level_test' ? 'a level test' : 'a teacher'} are required.`}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2">
              <button
                onClick={() => setShowAddLessonModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 bg-white border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLesson}
                disabled={addLessonSaving || !lessonFormValid}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {addLessonSaving ? 'Adding…' : 'Add Lesson'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Add Course Modal ─────────────────────────────────────────────────── */}
      {showAddCourseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowAddCourseModal(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#DEE7FF] bg-gradient-to-r from-[#F8FAFF] to-[#EEF4FF]">
              <h2 className="text-base font-bold text-[#2A2035] font-display">Add Course</h2>
              <p className="text-xs text-[#2A2035]/50 mt-0.5">Create a new course. The ID and created date are set automatically.</p>
            </div>

            {/* Body — one field per editable course column */}
            <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
              {courseFormCols.map(([col, m]) => {
                const opts = dropdownOptions(T_COURSES, col)
                const ek   = fieldEditorKind(T_COURSES, col)
                const val  = newCourseForm[col] ?? ''
                const set  = (v) => setNewCourseForm(p => ({ ...p, [col]: v }))
                return (
                  <div key={col}>
                    <label className="block text-xs font-semibold text-[#2A2035] mb-1.5">
                      {columnLabel(T_COURSES, col)}{m.required && <span className="text-red-400"> *</span>}
                    </label>
                    {opts ? (
                      <select
                        value={val}
                        onChange={e => set(e.target.value)}
                        className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                      >
                        <option value="">Select…</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        inputMode={ek === 'currency' || ek === 'number' || ek === 'percent' ? 'decimal' : undefined}
                        value={val}
                        onChange={e => set(e.target.value)}
                        placeholder={ek === 'currency' ? '0.00' : ''}
                        onKeyDown={e => { if (e.key === 'Enter' && courseFormValid) handleAddCourse() }}
                        className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#2A2035] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30 focus:border-[#325099]"
                      />
                    )}
                    {m.help && <p className="text-[10px] text-[#2A2035]/40 mt-1">{m.help}</p>}
                  </div>
                )
              })}
              {!courseFormValid && <p className="text-[11px] text-[#2A2035]/40">Fields marked * are required.</p>}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2">
              <button
                onClick={() => setShowAddCourseModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 bg-white border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCourse}
                disabled={addCourseSaving || !courseFormValid}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {addCourseSaving ? 'Adding…' : 'Add Course'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top-up Invoice Modal ─────────────────────────────────────────────── */}
      {topUpModal && (
        <TopUpInvoiceModal
          inv={topUpModal}
          onClose={() => setTopUpModal(null)}
          onCreated={() => { setTopUpModal(null); setReloadKey(k => k + 1) }}
        />
      )}

      {/* ── Add Enrolment Modal ──────────────────────────────────────────────── */}
      {showAddEnrolmentModal && (
        <AddEnrolmentModal
          allTerms={allTerms}
          onClose={() => setShowAddEnrolmentModal(false)}
          onCreated={() => { setShowAddEnrolmentModal(false); setReloadKey(k => k + 1) }}
        />
      )}

      {cancelModal && (
        <CancelLessonModal
          row={cancelModal.row}
          onClose={() => setCancelModal(null)}
          onCancelled={(lessonId, studentId, result) => {
            setCancelModal(null)
            setLessonCancellations(prev => ({
              ...prev,
              [lessonId]: [
                ...(prev[lessonId] || []),
                {
                  id: result.cancellation_id,
                  lesson_id: lessonId,
                  student_id: studentId,
                  type: result.type,
                  held_for_next_term: result.held_for_next_term,
                  credit_amount: result.credit_amount,
                  students: { full_name: cancelModal.row._studentName || '' },
                },
              ],
            }))
          }}
        />
      )}
    </div>
  )
}

// ── Add Credit Modal ──────────────────────────────────────────────────────────
function AddCreditModal({ members, onClose, onSave }) {
  const [studentId, setStudentId] = useState(members?.[0]?.id ?? '')
  const [amount, setAmount]       = useState('')
  const [reason, setReason]       = useState('missed_lesson')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  const REASONS = [
    { value: 'missed_lesson',  label: 'Missed lesson' },
    { value: 'late_start',     label: 'Late start' },
    { value: 'other',          label: 'Other' },
  ]

  const handleSubmit = async () => {
    if (!studentId || !amount || Number(amount) <= 0) return
    setSaving(true)
    await onSave({ studentId, amount, reason, notes })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#2A2035] text-sm">Add Credit</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>

        {members.length > 1 && (
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)}
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Amount ($)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 50"
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
        </div>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Notes (optional)</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Missed Week 4 lesson"
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !amount || Number(amount) <= 0}
            className="px-5 py-2 bg-[#325099] text-white text-sm font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
            {saving ? 'Saving…' : 'Apply Credit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Log Referral Modal ────────────────────────────────────────────────────────
function ReferralModal({ students, onClose, onSave }) {
  const [referringId, setReferringId] = useState('')
  const [referredId, setReferredId]   = useState('')
  const [saving, setSaving]           = useState(false)

  const handleSubmit = async () => {
    if (!referringId || !referredId) return
    setSaving(true)
    await onSave({ referringStudentId: referringId, referredStudentId: referredId })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#2A2035] text-sm">Log Referral</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        <p className="text-xs text-[#2A2035]/60 -mt-2">
          Both families receive <strong>$50 off</strong>. The referred family gets it immediately; the referring family gets it on their next invoice.
        </p>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Referring student (existing family)</label>
          <select value={referringId} onChange={e => setReferringId(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Select student…</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Referred student (new family)</label>
          <select value={referredId} onChange={e => setReferredId(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Select student…</option>
            {students.filter(s => s.id !== referringId).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>

        {referringId && referredId && (
          <div className="rounded-xl bg-[#F0FDF4] border border-[#A7F3D0] px-4 py-3 text-xs text-[#065F46]">
            <p>✓ <strong>{students.find(s => s.id === referredId)?.full_name}</strong> — $50 applied to their current invoice</p>
            <p className="mt-1">✓ <strong>{students.find(s => s.id === referringId)?.full_name}</strong> — $50 pending for their next invoice</p>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !referringId || !referredId || referringId === referredId}
            className="px-5 py-2 bg-[#7C3AED] text-white text-sm font-semibold rounded-lg hover:bg-[#6D28D9] transition disabled:opacity-40">
            {saving ? 'Logging…' : 'Log Referral'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Enrolment Modal ───────────────────────────────────────────────────────
const DAY_ORDER_ENR = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

function isoDateEnr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function AddEnrolmentModal({ onClose, onCreated }) {
  const [students, setStudents]   = useState([])
  const [classes,  setClasses]    = useState([])
  const [studentSearch, setStudentSearch] = useState('')
  const [classSearch,   setClassSearch]   = useState('')
  const [studentId, setStudentId] = useState('')
  const [classId,   setClassId]   = useState('')
  const [status,    setStatus]    = useState('active')
  const [startWeek, setStartWeek] = useState(1)
  const [trialStartDate, setTrialStartDate] = useState(null)
  const [trialLoading,   setTrialLoading]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => {
    supabase.from('students').select('id, full_name, school, year').order('full_name')
      .then(({ data }) => setStudents(data || []))
    // Join courses to get course_price
    supabase.from('classes').select('id, class_name, day_of_week, start_time, end_time, courses(course_price)').order('class_name')
      .then(({ data }) => setClasses(data || []))
  }, [])

  // Trial start = the class's lesson on its class day in the selected start week.
  useEffect(() => {
    let alive = true
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      if (status !== 'trial' || !classId) { setTrialStartDate(null); return }
      setTrialLoading(true)
      const { data } = await supabase
        .from('lessons')
        .select('lesson_date')
        .eq('class_id', classId)
        .eq('week', startWeek)
        .is('makeup_student_id', null)
        .order('lesson_date', { ascending: true })
      if (!alive) return
      // Prefer an upcoming lesson for that week; otherwise the earliest matching one.
      const today = isoDateEnr(new Date())
      const pick = (data || []).find(d => d.lesson_date >= today) || (data || [])[0]
      setTrialStartDate(pick?.lesson_date || null)
      setTrialLoading(false)
    })()
    return () => { alive = false }
  }, [classId, status, startWeek])

  const filteredStudents = students.filter(s =>
    !studentSearch || s.full_name.toLowerCase().includes(studentSearch.toLowerCase()) ||
    (s.school || '').toLowerCase().includes(studentSearch.toLowerCase())
  )
  const filteredClasses = classes.filter(c =>
    !classSearch || (c.class_name || '').toLowerCase().includes(classSearch.toLowerCase())
  )

  const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const fmtTime = (t) => {
    if (!t) return ''
    const [h, m] = t.split(':')
    let hr = parseInt(h); const mn = (m||'00').padStart(2,'0')
    const ap = hr >= 12 ? 'pm' : 'am'
    const display = hr === 0 ? 12 : (hr > 12 ? hr - 12 : hr)
    return `${display}:${mn}${ap}`
  }

  const selectedStudent = students.find(s => s.id === studentId)
  const selectedClass   = classes.find(c => c.id === classId)
  const coursePrice     = selectedClass ? Number(selectedClass.courses?.course_price ?? 0) : 0
  const weeksRemaining  = Math.max(1, 11 - startWeek)
  const proRatedPrice   = coursePrice > 0 ? Math.round(coursePrice * weeksRemaining / 10 * 100) / 100 : null

  const canSubmit = studentId && classId && (status !== 'trial' || trialStartDate)

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setError('')
    const payload = {
      student_id: studentId,
      class_id:   classId,
      status,
      price: proRatedPrice,
      trial_start_date: status === 'trial' ? trialStartDate : null,
    }
    const { data: newEnrol, error: err } = await supabase.from('enrolments').insert(payload).select('id').single()
    if (err) { setError(err.message); setSaving(false); return }

    // A trial enrolment also needs a trial_submissions row so it appears in the
    // Trials UI (which is driven by trial_submissions, incl. convert/decline).
    if (status === 'trial') {
      await supabase.from('trial_submissions').insert({
        submitted_at: new Date().toISOString(),
        student_name: selectedStudent?.full_name || null,
        student_year: selectedStudent?.year != null ? String(selectedStudent.year) : null,
        school: selectedStudent?.school || null,
        trial_class_id: classId,
        trial_date: trialStartDate || null,
        status: 'trial_scheduled',
        source: 'manual',
        converted_student_id: studentId,
        enrolment_id: newEnrol?.id || null,
      })
    }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-[#DEE7FF] bg-gradient-to-r from-[#F8FAFF] to-[#EEF4FF]">
          <h2 className="text-base font-bold text-[#2A2035] font-display">Add Enrolment</h2>
          <p className="text-xs text-[#2A2035]/50 mt-0.5">Link an existing student to an existing class.</p>
        </div>

        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5 flex-1">

          <div>
            <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-1.5">Student</label>
            {selectedStudent ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-[#325099] bg-[#EEF4FF]">
                <div>
                  <p className="text-sm font-semibold text-[#2A2035]">{selectedStudent.full_name}</p>
                  <p className="text-[11px] text-[#2A2035]/50">{selectedStudent.school}{selectedStudent.year ? ` · Year ${selectedStudent.year}` : ''}</p>
                </div>
                <button onClick={() => { setStudentId(''); setStudentSearch('') }} className="text-xs text-[#325099] hover:underline">Change</button>
              </div>
            ) : (
              <>
                <input type="text" placeholder="Search by name or school…" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#DEE7FF] text-xs text-[#2A2035] placeholder-[#2A2035]/30 focus:outline-none focus:border-[#325099] mb-1.5" />
                <div className="border border-[#DEE7FF] rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                  {filteredStudents.length === 0
                    ? <p className="px-3 py-2 text-xs text-[#2A2035]/40 italic">No students found</p>
                    : filteredStudents.map(s => (
                      <button key={s.id} onClick={() => setStudentId(s.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-[#EEF4FF] transition border-b border-[#DEE7FF] last:border-0">
                        <span className="font-semibold text-[#2A2035]">{s.full_name}</span>
                        <span className="text-[#2A2035]/50 ml-2">{s.school}{s.year ? ` · Yr ${s.year}` : ''}</span>
                      </button>
                    ))
                  }
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-1.5">Class</label>
            {selectedClass ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-[#325099] bg-[#EEF4FF]">
                <div>
                  <p className="text-sm font-semibold text-[#2A2035]">{selectedClass.class_name}</p>
                  <p className="text-[11px] text-[#2A2035]/50">{selectedClass.day_of_week} · {fmtTime(selectedClass.start_time)}–{fmtTime(selectedClass.end_time)}</p>
                </div>
                <button onClick={() => { setClassId(''); setClassSearch('') }} className="text-xs text-[#325099] hover:underline">Change</button>
              </div>
            ) : (
              <>
                <input type="text" placeholder="Search by class name…" value={classSearch} onChange={e => setClassSearch(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#DEE7FF] text-xs text-[#2A2035] placeholder-[#2A2035]/30 focus:outline-none focus:border-[#325099] mb-1.5" />
                <div className="border border-[#DEE7FF] rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                  {filteredClasses.length === 0
                    ? <p className="px-3 py-2 text-xs text-[#2A2035]/40 italic">No classes found</p>
                    : filteredClasses.map(c => (
                      <button key={c.id} onClick={() => setClassId(c.id)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-[#EEF4FF] transition border-b border-[#DEE7FF] last:border-0">
                        <span className="font-semibold text-[#2A2035]">{c.class_name}</span>
                        <span className="text-[#2A2035]/50 ml-2">{c.day_of_week} · {fmtTime(c.start_time)}–{fmtTime(c.end_time)}</span>
                      </button>
                    ))
                  }
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#DEE7FF] text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="trial complete">Trial complete</option>
                <option value="disenrol">Disenrol</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-1.5">Start week</label>
              <select value={startWeek} onChange={e => setStartWeek(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[#DEE7FF] text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
                {[1,2,3,4,5,6,7,8,9,10].map(w => (
                  <option key={w} value={w}>Week {w}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Pro-rated price preview */}
          {classId && (
            <div className={`rounded-xl px-4 py-3 text-xs ${proRatedPrice !== null ? 'bg-[#F0FDF4] border border-[#A7F3D0]' : 'bg-[#F8FAFF] border border-[#DEE7FF]'}`}>
              <p className="font-bold text-[10px] tracking-widest uppercase text-[#065F46] mb-1">Pro-rated price</p>
              {proRatedPrice !== null ? (
                <>
                  <p className="font-semibold text-[#2A2035] text-sm">${proRatedPrice.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-[#2A2035]/50 mt-0.5">
                    ${coursePrice.toLocaleString()} full price × {weeksRemaining}/10 weeks (starting Week {startWeek})
                  </p>
                </>
              ) : (
                <p className="text-[#2A2035]/40 italic">No course price set — price will be left blank.</p>
              )}
            </div>
          )}

          {status === 'trial' && classId && (
            <div className={`rounded-xl px-4 py-3 text-xs ${trialStartDate ? 'bg-[#FFFBEB] border border-[#FDE68A]' : 'bg-[#F8FAFF] border border-[#DEE7FF]'}`}>
              <p className="font-bold text-[10px] tracking-widest uppercase text-[#92400E] mb-1">Trial start date</p>
              {trialLoading ? (
                <p className="text-[#2A2035]/50 italic">Finding next lesson…</p>
              ) : trialStartDate ? (
                <>
                  <p className="font-semibold text-[#2A2035]">{fmtDate(trialStartDate)}</p>
                  <p className="text-[#2A2035]/50 mt-0.5">Trial covers the next 2 lessons from this date (inclusive).</p>
                </>
              ) : (
                <p className="text-[#B23A3A]">No upcoming lessons found for this class. Check term dates.</p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-[#B23A3A] rounded-lg bg-red-50 border border-red-200 px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 bg-white border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !canSubmit}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Adding…' : 'Add Enrolment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Invoice Modal ─────────────────────────────────────────────────────────
function TopUpInvoiceModal({ inv, onClose, onCreated }) {
  const [enrolments, setEnrolments] = useState([])   // new enrolments only (added after invoice)
  const [checked,    setChecked]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const memberIds = inv.members.map(m => m.id)
  const genCutoff = inv.generated_at ? new Date(inv.generated_at) : null

  useEffect(() => {
    if (!memberIds.length || !inv.term_id) { setLoading(false); return }
    ;(async () => {
      const { data: termClasses } = await supabase
        .from(T_CLASSES).select('id, class_name').eq('term_id', inv.term_id)
      const termClassIds = (termClasses || []).map(c => c.id)
      if (!termClassIds.length) { setLoading(false); return }

      const classNameMap = Object.fromEntries((termClasses || []).map(c => [c.id, c.class_name]))

      const { data: enrRows } = await supabase
        .from(T_ENROLMENTS)
        .select('id, student_id, class_id, price, created_at')
        .in('student_id', memberIds)
        .in('class_id', termClassIds)
        .order('created_at', { ascending: true })

      const allRows = (enrRows || []).map(e => ({
        key:         `${e.student_id}__${e.class_id}`,
        enrolmentId: e.id,
        studentId:   e.student_id,
        studentName: inv.members.find(m => m.id === e.student_id)?.full_name ?? '—',
        classId:     e.class_id,
        className:   classNameMap[e.class_id] ?? '—',
        price:       Number(e.price ?? 0),
        createdAt:   e.created_at,
      }))

      // Show all enrolments; pre-tick those added after the invoice was last generated
      const newRows = allRows
      const initChecked = Object.fromEntries(newRows.map(r => [r.key, !genCutoff || new Date(r.createdAt) > genCutoff]))

      setEnrolments(newRows)
      setChecked(initChecked)
      setLoading(false)
    })()
  }, [])

  const checkedRows = enrolments.filter(e => checked[e.key])

  // Multi-course discount: -$50 per student being topped up who already had enrolments at invoice generation time
  const studentsWithDiscount = [...new Set(checkedRows.map(e => e.studentId))].filter(id =>
    inv.members.find(m => m.id === id)?.enrolments?.length > 0
  )
  const multiCourseDiscount  = studentsWithDiscount.length * 50

  // Price is already pro-rated on the enrolment — no further pro-rating needed
  const subtotal = checkedRows.reduce((s, e) => s + e.price, 0)
  const total    = Math.max(0, subtotal - multiCourseDiscount)

  const fmt = n => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  const handleSubmit = async () => {
    if (!checkedRows.length) return
    setSaving(true); setError('')
    const payload = {
      term_id:              inv.term_id,
      family_id:            inv.family_id   ?? null,
      student_id:           inv.student_id  ?? null,
      subtotal:             subtotal,
      sibling_discount:     0,
      multi_course_discount: multiCourseDiscount,
      total:                total,
      status:               'unpaid',
    }
    const { error: err } = await supabase.from(T_INVOICES).insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    onCreated()
  }

  // Group enrolments by student for display
  const byStudent = {}
  for (const e of enrolments) {
    if (!byStudent[e.studentId]) byStudent[e.studentId] = { name: e.studentName, rows: [] }
    byStudent[e.studentId].rows.push(e)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#E8D5FF] bg-gradient-to-r from-[#FAF5FF] to-[#F3E8FF]">
          <p className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#7C3AED]/60 mb-0.5">New invoice</p>
          <h2 className="text-base font-bold text-[#2A2035] font-display">{inv.displayName} — {inv.termName}</h2>
          <p className="text-[11px] text-[#2A2035]/50 mt-0.5">Select enrolments to include. New enrolments are pre-ticked. Prices are already pro-rated.</p>
        </div>

        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5 flex-1">
          {loading ? (
            <p className="text-sm text-[#2A2035]/50 italic text-center py-4">Loading enrolments…</p>
          ) : enrolments.length === 0 ? (
            <p className="text-sm text-[#2A2035]/50 italic text-center py-4">No enrolments found for this family in this term.</p>
          ) : (
            <>
              {Object.values(byStudent).map(({ name, rows }) => (
                <div key={name}>
                  <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-[#325099] mb-2">{name}</p>
                  <div className="space-y-1.5">
                    {rows.map(e => {
                      const isChecked = !!checked[e.key]
                      return (
                        <label key={e.key} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition ${isChecked ? 'border-[#7C3AED] bg-[#FAF5FF]' : 'border-[#DEE7FF] bg-white hover:bg-[#F8FAFF]'}`}>
                          <input type="checkbox" checked={isChecked} onChange={() => setChecked(p => ({ ...p, [e.key]: !p[e.key] }))} className="accent-[#7C3AED] w-3.5 h-3.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[#2A2035]">{e.className}</p>
                            <p className="text-[10px] text-[#2A2035]/50">Added {fmtDate(e.createdAt)}</p>
                          </div>
                          <p className="text-xs font-bold text-[#7C3AED] shrink-0">{fmt(e.price)}</p>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* Totals */}
              {checkedRows.length > 0 && (
                <div className="rounded-xl border border-[#E8D5FF] bg-[#FAF5FF] px-4 py-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-[#2A2035]/60">
                    <span>Subtotal</span>
                    <span className="tabular-nums font-semibold">{fmt(subtotal)}</span>
                  </div>
                  {multiCourseDiscount > 0 && (
                    <div className="flex justify-between text-xs text-[#7C3AED]">
                      <span>Multi-course discount ({studentsWithDiscount.length}× −$50)</span>
                      <span className="tabular-nums">−{fmt(multiCourseDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-[#2A2035] pt-1.5 border-t border-[#E8D5FF]">
                    <span>Total</span>
                    <span className="tabular-nums text-[#7C3AED]">{fmt(total)}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-[#B23A3A] bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#E8D5FF] bg-[#FAF5FF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 bg-white border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !checkedRows.length}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#7C3AED] rounded-lg hover:bg-[#6D28D9] transition disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Creating…' : `Create invoice (${fmt(total)})`}
          </button>
        </div>
      </div>
    </div>
  )
}

