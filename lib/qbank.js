import { supabase } from './supabase'
import {
  T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SKILLS, QBANK_BUCKET,
} from './tables'

/*
 * Question-bank data helpers.
 * Keeps Supabase calls for the taxonomy + image storage in one place so the
 * pages stay focused on UI.
 */

export const DIFFICULTY_LABELS = {
  1: 'Very easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very hard',
}
export const DIFFICULTY_COLORS = {
  1: '#16A34A', 2: '#65A30D', 3: '#CA8A04', 4: '#EA580C', 5: '#DC2626',
}

// Public URL for an image stored in the qbank bucket.
export function qbankImageUrl(path) {
  if (!path) return null
  const { data } = supabase.storage.from(QBANK_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

// Upload a File to the qbank bucket under a question-scoped path. Returns the path.
export async function uploadQbankImage(file, prefix = 'questions') {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase()
  const rand = Math.random().toString(36).slice(2, 10)
  const path = `${prefix}/${Date.now()}-${rand}.${ext}`
  const { error } = await supabase.storage
    .from(QBANK_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  return path
}

export async function deleteQbankImage(path) {
  if (!path) return
  await supabase.storage.from(QBANK_BUCKET).remove([path])
}

// ── Taxonomy fetch ────────────────────────────────────────────────────────────
export async function fetchSubjects() {
  const { data } = await supabase.from(T_QBANK_SUBJECTS)
    .select('*').order('year_level').order('sort_order').order('name')
  return data || []
}
export async function fetchTopics() {
  const { data } = await supabase.from(T_QBANK_TOPICS)
    .select('*').order('sort_order').order('name')
  return data || []
}
export async function fetchSkills() {
  const { data } = await supabase.from(T_QBANK_SKILLS)
    .select('*').order('sort_order').order('name')
  return data || []
}

// Returns { subjects, topics, skills, topicsBySubject, skillsByTopic }.
export async function fetchTaxonomy() {
  const [subjects, topics, skills] = await Promise.all([
    fetchSubjects(), fetchTopics(), fetchSkills(),
  ])
  const topicsBySubject = {}
  topics.forEach((t) => {
    (topicsBySubject[t.subject_id] ||= []).push(t)
  })
  const skillsByTopic = {}
  skills.forEach((s) => {
    (skillsByTopic[s.topic_id] ||= []).push(s)
  })
  return { subjects, topics, skills, topicsBySubject, skillsByTopic }
}

// Distinct, sorted year levels present in the subject list.
export function yearsFromSubjects(subjects) {
  return [...new Set(subjects.map((s) => s.year_level))].sort((a, b) => a - b)
}
