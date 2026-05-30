'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { fetchAllTerms, getCurrentTerm } from '../../../lib/terms'
import TutorNav from '../../../components/TutorNav'
import { T_ADMINS, T_ATTENDANCE, T_BOOKLETS, T_CLASSES, T_CLASS_BOOKLETS, T_COURSES, T_CURRENT_TUTOR_RATES, T_DROPIN_SESSIONS, T_DROPIN_SIGNINS, T_ENROLMENTS, T_EXAMS, T_FAQ_CATEGORIES, T_FAQ_ITEMS, T_INFO_PAGES, T_PARENTS, T_PAY_RUNS, T_PAY_RUN_SHIFTS, T_PREPOST_SCORES, T_PREPOST_TESTS, T_QUIZ_RESULTS, T_RESULTS, T_SHIFTS, T_STUDENTS, T_SUB_ASSIGNMENTS, T_TERMS, T_TERM_COMMENTS, T_TERM_CRITERIA, T_TIMETABLE, T_TUTORS, T_TUTOR_RATE_MATRIX } from '../../../lib/tables'

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
  { label: 'Core',                 tables: [T_STUDENTS,T_TUTORS,T_ADMINS,T_PARENTS,T_COURSES,T_CLASSES,T_ENROLMENTS,T_TERMS,'subjects'] },
  { label: 'Attendance & Results', tables: [T_ATTENDANCE,T_QUIZ_RESULTS,T_RESULTS,T_EXAMS,T_PREPOST_TESTS,T_PREPOST_SCORES] },
  { label: 'Content',              tables: [T_BOOKLETS,T_CLASS_BOOKLETS,T_INFO_PAGES,T_FAQ_CATEGORIES,T_FAQ_ITEMS] },
  { label: 'Scheduling',           tables: [T_TIMETABLE,T_DROPIN_SESSIONS,T_DROPIN_SIGNINS,T_SHIFTS,T_SUB_ASSIGNMENTS] },
  { label: 'Finance',              tables: [T_PAY_RUNS,'pay_run_lines',T_PAY_RUN_SHIFTS,T_CURRENT_TUTOR_RATES,T_TUTOR_RATE_MATRIX] },
  { label: 'Reports',              tables: [T_TERM_CRITERIA,T_TERM_COMMENTS] },
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
}

const GUARDIAN_COLS    = ['guardian_name','guardian_relationship','guardian_email','guardian_phone']
const PARENT_COL_MAP   = { guardian_name:'full_name', guardian_relationship:'relationship', guardian_email:'email', guardian_phone:'phone' }
const ENROLMENT_NAME_COLS = ['student_name','class_name']
const TERM_NAME_COL    = 'term_name'
const COURSE_NAME_COL  = 'course_name'

const DEFAULT_WIDTH  = 150
const PRESET_WIDTHS  = { id:100, year:80, role:90, gender:90, guardian_relationship:140, guardian_name:160, guardian_email:200, guardian_phone:130, email:200, full_name:180, student_name:200, class_name:220, term_name:160, course_name:200 }
function defaultWidth(col) { return PRESET_WIDTHS[col] ?? DEFAULT_WIDTH }

function displayVal(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object')  return JSON.stringify(v)
  return String(v)
}
function getPkCol(cols) { return cols.includes('id') ? 'id' : null }

const COLUMN_TYPES = ['text','integer','bigint','numeric','boolean','uuid','timestamp with time zone','date','jsonb']

async function execDDL(token, sql) {
  const res  = await fetch('/api/exec-ddl', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` }, body: JSON.stringify({ sql }) })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'DDL failed')
}

// ── Undo action descriptors ───────────────────────────────────────────────────
function undoLabel(action) {
  if (!action) return null
  if (action.type === 'rename_col')   return `Undo rename column "${action.oldName}" → "${action.newName}"`
  if (action.type === 'drop_col')     return `Undo drop column "${action.col}"`
  if (action.type === 'rename_table') return `Undo rename table "${action.oldName}" → "${action.newName}"`
  if (action.type === 'delete_row')   return `Undo delete row`
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
function ColContextMenu({ x, y, col, isPk, isGuardian, onRename, onDelete, onClose }) {
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
        onClick={onRename}
        disabled={isPk}
        className="w-full text-left px-3 py-2 text-sm text-[#2A2035] hover:bg-[#F0F4FF] transition flex items-center gap-2.5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span className="text-base leading-none">✏️</span>
        <span className="font-medium">Rename</span>
      </button>
      <button
        onClick={onDelete}
        disabled={isPk || isGuardian}
        className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition flex items-center gap-2.5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <span className="text-base leading-none">🗑</span>
        <span className="font-medium">Delete column</span>
        {isGuardian && <span className="text-[9px] text-[#2A2035]/30 ml-auto">(parent table)</span>}
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function DatabasePage() {
  const router = useRouter()

  const [staff, setStaff]           = useState(null)
  const [currentTermId, setCurrentTermId]     = useState(null)
  const [currentTermName, setCurrentTermName] = useState('')
  // Maps table name → PostgreSQL OID (stable across renames). Used as
  // localStorage key suffix so column customisations survive table renames.
  const [tableOids, setTableOids]   = useState({})
  const [tableGroups, setTableGroups] = useState(() => {
    try {
      const saved = typeof window !== 'undefined' && localStorage.getItem('cube_db_table_groups')
      if (!saved) return INITIAL_TABLE_GROUPS
      const parsed = JSON.parse(saved)
      // Merge any tables from INITIAL_TABLE_GROUPS that are missing from the saved state
      // (e.g. newly added tables like 'courses' won't appear until this runs)
      let changed = false
      const merged = parsed.map(g => {
        const initial = INITIAL_TABLE_GROUPS.find(ig => ig.label === g.label)
        if (!initial) return g
        const missing = initial.tables.filter(t => !g.tables.includes(t))
        if (missing.length === 0) return g
        changed = true
        // Insert missing tables at the same relative position they appear in INITIAL
        const next = [...g.tables]
        for (const t of missing) {
          const idx = initial.tables.indexOf(t)
          const insertBefore = initial.tables.slice(idx + 1).find(s => next.includes(s))
          if (insertBefore) next.splice(next.indexOf(insertBefore), 0, t)
          else next.push(t)
        }
        return { ...g, tables: next }
      })
      if (changed) {
        try { localStorage.setItem('cube_db_table_groups', JSON.stringify(merged)) } catch {}
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

  // Column layout
  const [columnOrder, setColumnOrder]   = useState([])
  const [columnWidths, setColumnWidths] = useState({})
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

  // Add Class modal (classes table only)
  const [showAddClassModal, setShowAddClassModal] = useState(false)
  const [newClassForm, setNewClassForm] = useState({ course_id: '', day_of_week: '', start_time: '', end_time: '' })
  const [coursesList, setCoursesList]   = useState([])
  const [addClassSaving, setAddClassSaving] = useState(false)

  // Search
  const [search, setSearch] = useState('')

  // Create / drop / rename table
  const [showCreateModal, setShowCreateModal]     = useState(false)
  const [dropConfirmTable, setDropConfirmTable]   = useState(null)
  const [ddlWorking, setDdlWorking]               = useState(false)
  const [ddlError, setDdlError]                   = useState(null)
  const [hoveredTable, setHoveredTable]           = useState(null)
  const [renamingTable, setRenamingTable]         = useState(null)
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
  const saveTableGroups = useCallback((groups) => { try { localStorage.setItem('cube_db_table_groups', JSON.stringify(groups)) } catch {} }, [])

  const pushUndo = useCallback((action) => {
    setUndoStack(prev => [...prev.slice(-29), action])
  }, [])

  // ── Auth ────────────────────────────────────────────────────────────────────
  // Role is stored in app_metadata (server-side only) so it survives DB changes.
  useEffect(() => {
    ;(async () => {
      const { data:{ user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      if (user.app_metadata?.role !== 'admin') { router.push('/tutor'); return }
      // Fetch profile just for display name — admins live in the admins table
      const { data: profile } = await supabase.from(T_ADMINS).select('full_name, email').eq('id', user.id).single()
      setStaff({ ...user, full_name: profile?.full_name ?? user.email })
      // Fetch current term so new class rows get term_id pre-filled
      const terms = await fetchAllTerms()
      const cur = getCurrentTerm(terms)
      if (cur) {
        setCurrentTermId(cur.id)
        setCurrentTermName(cur.name || `Term ${cur.term_number} ${cur.year}`)
      }

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

    let q = supabase.from(realTable).select(selectStr).limit(500)
    if (v?.filterCol) q = v.filterOp === 'in' ? q.in(v.filterCol, v.filterVal) : q.eq(v.filterCol, v.filterVal)

    q.then(async ({ data, error }) => {
      if (error) { setTableError(error.message); setLoading(false); return }
      const r = data || []

      let cols = v?.showCols
        ? v.showCols.filter(c => r.length === 0 || c in (r[0] ?? {}))
        : r.length > 0 ? Object.keys(r[0]) : []

      // Strip system/hidden columns (e.g. role — managed via auth app_metadata)
      if (v?.excludeCols?.length) cols = cols.filter(c => !v.excludeCols.includes(c))

      let enrichedRows = r

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
        const [{ data: studentRows }, { data: classRows }] = await Promise.all([
          supabase.from(T_STUDENTS).select('id, full_name').in('id', studentIds),
          supabase.from(T_CLASSES).select('id, class_name').in('id', classIds),
        ])
        const sMap = Object.fromEntries((studentRows || []).map(s => [s.id, s.full_name]))
        const cMap = Object.fromEntries((classRows  || []).map(c => [c.id, c.class_name]))
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

      setColumns(cols); setRows(enrichedRows); setLoading(false)
    })
  }, [selectedTable, staff, reloadKey])

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

  // ── Restore column layout from localStorage when columns load ───────────────
  useEffect(() => {
    if (columns.length === 0) return
    try {
      const stableKey   = tableStableKey(selectedTable)
      const savedOrder  = JSON.parse(localStorage.getItem(`cube_db_order_${stableKey}`)  ?? 'null')
      const savedWidths = JSON.parse(localStorage.getItem(`cube_db_widths_${stableKey}`) ?? 'null')

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
    } catch {
      setColumnOrder(columns)
      setColumnWidths(Object.fromEntries(columns.map(c => [c, defaultWidth(c)])))
    }
  }, [columns, selectedTable])

  // ── Focus effects ───────────────────────────────────────────────────────────
  useEffect(() => { if (editingCell   && editInputRef.current)    { editInputRef.current.focus();    editInputRef.current.select()    } }, [editingCell])
  useEffect(() => { if (renamingTable && renameInputRef.current)  { renameInputRef.current.focus();  renameInputRef.current.select()  } }, [renamingTable])
  useEffect(() => { if (renamingCol   && renameColInputRef.current){ renameColInputRef.current.focus(); renameColInputRef.current.select() } }, [renamingCol])

  // ── Keyboard shortcut: Ctrl/Cmd+Z → undo ────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [undoStack, selectedTable])   // re-bind when stack or table changes

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
  const handleDragOver  = (e, col) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverRef.current !== col) { dragOverRef.current = col; setDragOver(col) } }
  const handleDragLeave = () => { dragOverRef.current = null; setDragOver(null) }
  const handleDrop = (e, targetCol) => {
    e.preventDefault()
    const srcCol = dragColRef.current; dragColRef.current = null; dragOverRef.current = null; setDragOver(null)
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
  const handleDragEnd = () => { dragColRef.current = null; dragOverRef.current = null; setDragOver(null) }

  // ── Cell editing ─────────────────────────────────────────────────────────────
  const isGuardianCol = (col) => col in PARENT_COL_MAP
  const isNameCol     = (col) => ENROLMENT_NAME_COLS.includes(col) || col === TERM_NAME_COL || col === COURSE_NAME_COL

  const handleCellClick = (rowId, col, currentVal) => {
    if (col === pkCol || isNameCol(col)) return
    setDeleteConfirm(null); setContextMenu(null)
    setEditingCell({ rowId, col })
    setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal))
  }

  const handleCellSave = async () => {
    if (!editingCell) { setEditingCell(null); return }
    const { rowId, col } = editingCell
    setEditingCell(null); setSaving(true)
    const newVal = editValue === '' ? null : editValue
    const prevRows = rows
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
    } else {
      const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable
      const { error } = await supabase.from(realTable).update({ [col]: newVal }).eq(pkCol, rowId)
      if (error) { alert(`Save failed: ${error.message}`); setRows(prevRows) }
    }
    setSaving(false)
  }

  const handleCellKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); handleCellSave() }
    if (e.key === 'Escape') { setEditingCell(null) }
    if (e.key === 'Tab')    { e.preventDefault(); handleCellSave() }
  }

  // ── Add row ──────────────────────────────────────────────────────────────────
  const handleAddRow = async () => {
    setAddingSaving(true)
    const vConfig   = VIRTUAL[selectedTable]
    const realTable = vConfig?.realTable ?? selectedTable
    const payload   = { ...(vConfig?.defaultRow ?? {}) }
    // Auto-fill term_id for new classes rows
    if (selectedTable === 'classes' && currentTermId) payload.term_id = currentTermId
    for (const [k, v] of Object.entries(newRowData)) {
      if (k === pkCol || isGuardianCol(k) || k === TERM_NAME_COL || k === COURSE_NAME_COL) continue
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
      term_id:     currentTermId || null,
    }
    const { data, error } = await supabase.from(T_CLASSES).insert(payload).select().single()
    if (!error && data) {
      const enriched = {
        ...data,
        [COURSE_NAME_COL]: course ? `${course.course_name} (${course.course_code})` : null,
        [TERM_NAME_COL]:   currentTermName || null,
      }
      setRows(prev => [enriched, ...prev])
      setRowCounts(prev => ({ ...prev, [selectedTable]: (prev[selectedTable] ?? 0) + 1 }))
    }
    setAddClassSaving(false)
    setShowAddClassModal(false)
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
  const handleDropCol = async (col) => {
    setContextMenu(null)
    const realTable = VIRTUAL[selectedTable]?.realTable ?? selectedTable

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
      setColumnOrder(prev => { const next = remove(prev); saveOrder(selectedTable, next); return next })
      setColumnWidths(prev => { const next = removeKey(prev); saveWidths(selectedTable, next); return next })
      setRows(prev => prev.map(r => removeKey(r)))
      pushUndo({ type:'drop_col', table: selectedTable, realTable, col, colType })
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

  // ── Drop table ────────────────────────────────────────────────────────────
  const handleDropTable = async (tableName) => {
    setDdlWorking(true); setDdlError(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      await execDDL(session.access_token, `DROP TABLE IF EXISTS public.${tableName} CASCADE;`)
      setTableGroups(prev => { const next = prev.map(g => ({ ...g, tables: g.tables.filter(t => t !== tableName) })).filter(g => g.tables.length > 0); saveTableGroups(next); return next })
      setRowCounts(prev => { const n = {...prev}; delete n[tableName]; return n })
      if (selectedTable === tableName) setSelectedTable('students')
      setDropConfirmTable(null)
    } catch (err) { setDdlError(err.message) }
    finally { setDdlWorking(false) }
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

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = rows.filter(r => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(q))
  })

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</div>
    </div>
  )

  const vConfig  = VIRTUAL[selectedTable]
  const lastUndo = undoStack[undoStack.length - 1] ?? null

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

      {/* Create table modal */}
      {showCreateModal && <CreateTableModal onClose={() => setShowCreateModal(false)} onCreated={handleTableCreated} />}

      {/* Drop table confirm modal */}
      {dropConfirmTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0 text-xl">⚠️</div>
              <div>
                <h3 className="font-bold text-[#2A2035] text-sm">Drop table?</h3>
                <p className="text-xs text-[#2A2035]/60 mt-1">This will permanently delete <code className="font-mono text-red-600">{dropConfirmTable}</code> and all its data. This cannot be undone.</p>
              </div>
            </div>
            {ddlError && <p className="text-xs font-semibold text-red-600 bg-red-50 rounded-lg px-3 py-2">{ddlError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDropConfirmTable(null); setDdlError(null) }} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
              <button onClick={() => handleDropTable(dropConfirmTable)} disabled={ddlWorking} className="px-5 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 transition disabled:opacity-40">{ddlWorking ? 'Dropping…' : 'Drop Table'}</button>
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
          <div className="px-3 pt-3 pb-1 shrink-0">
            <button onClick={() => setShowCreateModal(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#325099]/30 hover:bg-[#325099]/50 text-white/70 hover:text-white text-[10px] font-bold tracking-[0.1em] uppercase transition">
              <span className="text-sm leading-none">+</span> New Table
            </button>
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

                  return (
                    <div key={t} className="relative" onMouseEnter={() => setHoveredTable(t)} onMouseLeave={() => setHoveredTable(null)}>
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
                        <button onClick={() => setSelectedTable(t)} className={`w-full text-left px-4 py-1.5 flex items-center justify-between gap-2 transition-colors ${canEdit && hovered ? 'pr-14' : 'pr-4'} ${active ? 'bg-[#325099] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium truncate">{t}</span>
                            {isVirtual && <span className={`text-[8px] shrink-0 ${active ? 'text-white/50' : 'text-white/20'}`}>⊂</span>}
                          </div>
                          {count !== undefined && !hovered && (
                            <span className={`text-[9px] tabular-nums shrink-0 font-semibold ${active ? 'text-white/60' : 'text-white/25'}`}>{count.toLocaleString()}</span>
                          )}
                        </button>
                      )}
                      {canEdit && hovered && !isRenaming && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                          <button onClick={e => { e.stopPropagation(); startRename(t) }} title={`Rename "${t}"`} className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-blue-300 hover:bg-blue-900/30 transition text-[10px]">✏️</button>
                          <button onClick={e => { e.stopPropagation(); setDropConfirmTable(t); setDdlError(null) }} title={`Drop "${t}"`} className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-red-400 hover:bg-red-900/30 transition text-[10px]">🗑</button>
                        </div>
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
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
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

            <div className="flex items-center gap-2 shrink-0">
              {/* Undo */}
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0 || undoing}
                title={lastUndo ? undoLabel(lastUndo) : 'Nothing to undo'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[#325099] border border-[#DEE7FF] text-xs font-semibold rounded-lg hover:bg-[#F0F4FF] hover:border-[#BACBFF] transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {undoing ? '…' : '↩'} Undo{lastUndo ? '' : ''}
              </button>

              {/* Rename + Drop (non-virtual tables only) */}
              {!vConfig && (
                <>
                  <button onClick={() => startRename(selectedTable)} className="flex items-center gap-1.5 px-3 py-1.5 text-[#325099] border border-[#DEE7FF] text-xs font-semibold rounded-lg hover:bg-[#F0F4FF] hover:border-[#BACBFF] transition">✏️ Rename</button>
                  <button onClick={() => { setDropConfirmTable(selectedTable); setDdlError(null) }} className="flex items-center gap-1.5 px-3 py-1.5 text-red-400 border border-red-200 text-xs font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition">🗑 Drop</button>
                </>
              )}

              {/* Search */}
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#325099]/40 text-xs pointer-events-none">🔍</span>
                <input type="text" placeholder="Search rows…" value={search} onChange={e => setSearch(e.target.value)} className="pl-7 pr-7 py-1.5 text-xs rounded-lg border border-[#DEE7FF] bg-white text-[#2A2035] placeholder-[#2A2035]/30 focus:outline-none focus:border-[#BACBFF] w-44 transition" />
                {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#2A2035]/30 hover:text-[#2A2035]/60 text-xs">✕</button>}
              </div>

              {selectedTable === 'classes' ? (
                <button onClick={openAddClassModal} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-sm leading-none">+</span> Add Class
                </button>
              ) : (
                <button onClick={() => { setAddingRow(true); setNewRowData({}); setDeleteConfirm(null) }} disabled={loading || !!tableError} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-sm leading-none">+</span> Add Row
                </button>
              )}
            </div>
          </div>

          {/* Hint bar */}
          {columns.length > 0 && !loading && (
            <div className="flex items-center gap-4 px-5 py-1.5 bg-[#F0F4FF] border-b border-[#DEE7FF] text-[10px] text-[#325099]/50 shrink-0 select-none">
              <span>↔ Drag header to reorder</span>
              <span>⟺ Drag right edge to resize</span>
              <span>Right-click header to rename or delete column</span>
              {vConfig?.joinParents && <span className="text-amber-600/60">Guardian cols update the <strong>parents</strong> table</span>}
            </div>
          )}

          {/* Grid */}
          <div className="flex-1 overflow-auto">
            {loading ? (
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
                <button onClick={selectedTable === 'classes' ? openAddClassModal : () => setAddingRow(true)} className="px-4 py-2 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition">{selectedTable === 'classes' ? '+ Add Class' : '+ Add first row'}</button>
              </div>
            ) : (
              <table className="text-xs border-separate border-spacing-0" style={{ tableLayout:'fixed', minWidth:'max-content' }}>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-20 bg-[#EEF1F8] border-b-2 border-r border-[#DEE7FF] text-center text-[10px] font-bold text-[#325099]/40 select-none" style={{ width:42, minWidth:42 }}>#</th>

                    {columnOrder.map(col => {
                      const isPk          = col === pkCol
                      const isGuardian    = isGuardianCol(col)
                      const isName        = isNameCol(col)
                      const isDragTarget  = dragOver === col
                      const isColRenaming = renamingCol === col
                      const canRenameCol  = !isPk && !isGuardian && !isName
                      const w = columnWidths[col] ?? defaultWidth(col)

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
                          className={`sticky top-0 z-20 border-b-2 border-r border-[#DEE7FF] text-left select-none transition-colors ${
                            isColRenaming ? 'bg-[#EEF4FF] border-b-[#325099]'
                            : isDragTarget ? 'bg-[#BACBFF] border-l-2 border-l-[#325099]'
                            : isGuardian   ? 'bg-[#FEF9EC]'
                            : isName       ? 'bg-[#ECFDF5]'
                            : 'bg-[#EEF1F8]'
                          }`}
                          style={{ width:w, minWidth:w, maxWidth:w, cursor: isColRenaming ? 'default' : 'grab' }}
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
                            <div className="flex items-center px-3 py-2.5 overflow-hidden gap-1">
                              {isPk       && <span className="text-[9px] text-amber-500 shrink-0">🔑</span>}
                              {isGuardian && <span className="text-[9px] text-amber-600/70 shrink-0">👤</span>}
                              {isName     && <span className="text-[9px] text-emerald-600/70 shrink-0">🔗</span>}
                              <span className={`text-[10px] font-bold tracking-[0.06em] uppercase truncate flex-1 min-w-0 ${isName ? 'text-emerald-800' : 'text-[#062E63]'}`}>{col}</span>
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

                    <th className="sticky top-0 z-20 bg-[#EEF1F8] border-b-2 border-[#DEE7FF]" style={{ width:56, minWidth:56 }} />
                  </tr>
                </thead>

                <tbody>
                  {addingRow && (
                    <tr className="bg-[#F0FDF4]">
                      <td className="border-b border-r border-[#DEE7FF] px-2 py-2 text-center text-[#065F46] font-bold">*</td>
                      {columnOrder.map(col => {
                        const w = columnWidths[col] ?? defaultWidth(col)
                        const defVal = vConfig?.defaultRow?.[col] ?? ''
                        return (
                          <td key={col} className="border-b border-r border-[#A7F3D0] p-0" style={{ width:w, maxWidth:w }}>
                            {col === pkCol ? (
                              <span className="block px-3 py-2 text-[#2A2035]/30 italic text-[10px]">auto</span>
                            ) : ENROLMENT_NAME_COLS.includes(col) || col === COURSE_NAME_COL || col === TERM_NAME_COL ? (
                              <span className="block px-3 py-2 text-emerald-600/40 italic text-[10px]">auto-resolved</span>
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
                        <td className="border-b border-r border-[#E8EDF8] px-2 py-1.5 text-center text-[#2A2035]/25 font-mono text-[10px] select-none" style={{ width:42 }}>{ri + 1}</td>

                        {columnOrder.map(col => {
                          const val       = row[col]
                          const isEditing = editingCell?.rowId === rowId && editingCell?.col === col
                          const isPk      = col === pkCol
                          const isGuardian = isGuardianCol(col)
                          const isName    = isNameCol(col)
                          const dv        = displayVal(val)
                          const truncated = dv !== null && dv.length > 50
                          const w         = columnWidths[col] ?? defaultWidth(col)

                          return (
                            <td key={col} className={`border-b border-r border-[#E8EDF8] p-0 ${isPk ? 'bg-[#F8FAFF]/60' : isGuardian ? 'bg-[#FFFBEB]/40' : isName ? 'bg-[#F0FDF4]/60' : ''}`} style={{ width:w, maxWidth:w }} onClick={() => !isPk && !isName && handleCellClick(rowId, col, val)}>
                              {isEditing ? (
                                <input ref={editInputRef} type="text" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={handleCellSave} onKeyDown={handleCellKeyDown} className="w-full px-3 py-1.5 bg-[#EEF4FF] border-2 border-[#325099] text-[#2A2035] focus:outline-none text-xs" style={{ width:w }} />
                              ) : (
                                <div className={`px-3 py-1.5 overflow-hidden whitespace-nowrap ${dv === null ? 'text-[#2A2035]/20 italic text-[10px]' : isPk ? 'text-[#325099]/60 font-mono text-[10px]' : isGuardian ? 'text-[#92400E]/80 text-xs' : isName ? 'text-emerald-800 text-xs font-medium' : 'text-[#2A2035] text-xs'} ${!isPk && !isName ? 'cursor-text' : 'cursor-default'}`} title={truncated ? dv : undefined}>
                                  {dv === null ? 'null' : truncated ? dv.slice(0,50)+'…' : dv}
                                </div>
                              )}
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
                    <tr><td colSpan={columnOrder.length + 2} className="px-4 py-10 text-center text-xs text-[#2A2035]/40">No rows match &ldquo;{search}&rdquo;</td></tr>
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
    </div>
  )
}
