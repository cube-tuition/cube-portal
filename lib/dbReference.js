/**
 * Reference-data + relationship layer for the Airtable-style database explorer.
 *
 * This file is ADDITIVE and READ-ONLY against the database. It never writes,
 * never migrates, and never changes a stored value. It powers two things:
 *
 *   1. useReferenceData() — loads the small "lookup" tables once and gives the
 *      explorer a fast id → human-readable label resolver for linked records.
 *   2. LINKED_SECTIONS  — declares which child collections to show on a record
 *      detail panel, using foreign keys that already exist in the schema.
 *
 * All relationships below are ones that already exist as real columns. Nothing
 * here invents a relationship or rewrites duplicated text.
 */
'use client'

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ── Reference (lookup) tables ─────────────────────────────────────────────────
// For each referenced table: the columns to load, the primary label column, and
// optional secondary columns shown as muted context in pickers / badges.
export const REFERENCE_TABLES = {
  students: { select: 'id, full_name, year, school, status', label: 'full_name', secondary: ['year', 'school', 'status'] },
  classes:  { select: 'id, class_name, day_of_week, start_time, end_time, teacher', label: 'class_name', secondary: ['day_of_week', 'start_time', 'teacher'] },
  terms:    { select: 'id, name, year', label: 'name', secondary: ['year'] },
  courses:  { select: 'id, course_name, course_code', label: 'course_name', secondary: ['course_code'] },
  tutors:   { select: 'id, full_name, email, active', label: 'full_name', secondary: ['email'], optionFilter: (r) => r.active !== false },
  guardians:{ select: 'id, full_name, email, phone', label: 'full_name', secondary: ['phone', 'email'] },
  invoices: { select: 'id, invoice_number, total, status', label: 'invoice_number', secondary: ['total', 'status'] },
}

function buildSecondary(cfg, row) {
  if (!cfg?.secondary?.length) return ''
  return cfg.secondary
    .map(c => row?.[c])
    .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
    .join(' · ')
}

/**
 * Loads every reference table once and exposes lookup helpers.
 *
 * Returns:
 *   ready       — true once the initial load has finished
 *   resolve(table, id) → { label, secondary, row } | null
 *   options(table)     → [{ id, label, secondary, row }]   (sorted by label)
 *   rowsFor(table)     → raw rows array
 *   reload()           — re-fetch (e.g. after an edit elsewhere)
 */
export function useReferenceData(enabled = true) {
  const [maps, setMaps] = useState({})   // { table: { byId: {id: row}, list: [row] } }
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      const entries = Object.entries(REFERENCE_TABLES)
      const results = await Promise.all(
        entries.map(async ([table, cfg]) => {
          const { data, error } = await supabase.from(table).select(cfg.select).limit(1000)
          if (error) return [table, { byId: {}, list: [] }]
          const list = data ?? []
          const byId = Object.fromEntries(list.map(r => [String(r.id), r]))
          return [table, { byId, list }]
        })
      )
      if (cancelled) return
      setMaps(Object.fromEntries(results))
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [enabled, tick])

  const resolve = (table, id) => {
    if (id === null || id === undefined || id === '') return null
    const cfg = REFERENCE_TABLES[table]
    const row = maps[table]?.byId?.[String(id)]
    if (!cfg || !row) return null
    return { label: row[cfg.label] ?? String(id), secondary: buildSecondary(cfg, row), row }
  }

  const options = (table) => {
    const cfg = REFERENCE_TABLES[table]
    const list = maps[table]?.list ?? []
    if (!cfg) return []
    return list
      .filter(row => (cfg.optionFilter ? cfg.optionFilter(row) : true))
      .map(row => ({ id: row.id, label: row[cfg.label] ?? String(row.id), secondary: buildSecondary(cfg, row), row }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }))
  }

  const rowsFor = (table) => maps[table]?.list ?? []

  return { ready, resolve, options, rowsFor, reload: () => setTick(t => t + 1) }
}

// ── Linked sections for the record detail panel ───────────────────────────────
// Each entry lists the child collections to show for a record of `realTable`.
// Every fkCol below is a real foreign-key-style column already in the schema.
//   table     child table to query
//   fkCol     column on the child table that points back at this record's id
//   labelCol  primary text to show for each child row
//   secondary muted context columns
export const LINKED_SECTIONS = {
  students: [
    { key: 'guardians',  label: 'Parents / Guardians', table: 'guardians',  fkCol: 'student_id', labelCol: 'full_name',  secondary: ['relationship', 'phone'] },
    { key: 'enrolments', label: 'Enrolments',          table: 'enrolments', fkCol: 'student_id', labelCol: 'class_id',   secondary: ['status', 'price'], linkLabelFrom: 'classes' },
    { key: 'attendance', label: 'Attendance',          table: 'attendance', fkCol: 'student_id', labelCol: 'session_date', secondary: ['status'] },
    { key: 'invoices',   label: 'Invoices',            table: 'invoices',   fkCol: 'student_id', labelCol: 'invoice_number', secondary: ['total', 'status'] },
  ],
  guardians: [
    // Parent record's main link is the student (shown in fields); no child rows.
  ],
  classes: [
    { key: 'enrolments', label: 'Enrolled students', table: 'enrolments', fkCol: 'class_id', labelCol: 'student_id', secondary: ['status'], linkLabelFrom: 'students' },
    { key: 'lessons',    label: 'Lessons',           table: 'lessons',    fkCol: 'class_id', labelCol: 'lesson_date', secondary: ['status', 'room'] },
    { key: 'attendance', label: 'Attendance',        table: 'attendance', fkCol: 'class_id', labelCol: 'session_date', secondary: ['status'] },
  ],
  enrolments: [
    // Pure join row; both sides (student, class) appear as linked fields.
  ],
  invoices: [
    // Student + term appear as linked fields; line items shown via JSON field.
  ],
  terms: [
    { key: 'classes', label: 'Classes', table: 'classes', fkCol: 'term_id', labelCol: 'class_name', secondary: ['day_of_week', 'teacher'] },
  ],
  courses: [
    { key: 'classes', label: 'Classes', table: 'classes', fkCol: 'course_id', labelCol: 'class_name', secondary: ['day_of_week', 'teacher'] },
  ],
  tutors: [
    { key: 'shifts',  label: 'Shifts',  table: 'shifts',  fkCol: 'tutor_id', labelCol: 'work_date', secondary: ['hours', 'status'] },
    { key: 'lessons', label: 'Scheduled lessons', table: 'lessons', fkCol: 'scheduled_teacher_id', labelCol: 'lesson_date', secondary: ['status'] },
  ],
  lessons: [
    { key: 'attendance', label: 'Attendance', table: 'attendance', fkCol: 'class_id', labelCol: 'session_date', secondary: ['status'], note: 'Same class — not filtered by this lesson date.' },
  ],
  attendance: [],
  shifts: [],
  trial_submissions: [],
}

export function linkedSectionsFor(realTable) {
  return LINKED_SECTIONS[realTable] ?? null
}
