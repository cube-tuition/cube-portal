import { supabase } from '../supabase'

/*
 * Info Centre data access. Pages keep two block arrays: `draft` (the working
 * copy editors change) and `published` (the live copy viewers read). Publishing
 * copies draft → published and writes a revision snapshot. "Unpublished changes"
 * is simply draft ≠ published.
 */

export const PAGE_COLS =
  'id, slug, title, icon, summary, category_id, draft, published, status, tags, visible_roles, pinned, mandatory, sort_order, scheduled_at, updated_at, updated_by_name, published_at'

export function hasUnpublishedChanges(p) {
  if (!p) return false
  if (p.status === 'draft') return true
  return JSON.stringify(p.draft || []) !== JSON.stringify(p.published || [])
}

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
}

async function uniqueSlug(base, ignoreId) {
  let slug = base
  for (let n = 1; n < 50; n++) {
    let q = supabase.from('infohub_pages').select('id').eq('slug', slug)
    if (ignoreId) q = q.neq('id', ignoreId)
    const { data } = await q.maybeSingle()
    if (!data) return slug
    slug = `${base}-${n + 1}`
  }
  return `${base}-${Date.now().toString(36)}`
}

// ── Categories ────────────────────────────────────────────────────────────────
export async function listCategories({ includeArchived = false } = {}) {
  let q = supabase.from('infohub_categories').select('*').order('sort_order')
  if (!includeArchived) q = q.eq('archived', false)
  const { data } = await q
  return data || []
}
export async function createCategory(name) {
  const { data } = await supabase.from('infohub_categories')
    .insert({ name: name || 'New category', slug: slugify(name) + '-' + Date.now().toString(36) })
    .select('*').single()
  return data
}
export async function updateCategory(id, patch) {
  await supabase.from('infohub_categories').update(patch).eq('id', id)
}

// ── Pages: lists ──────────────────────────────────────────────────────────────
// Dashboard (editors): every page.
export async function listAllPages() {
  const { data } = await supabase.from('infohub_pages').select(PAGE_COLS).order('sort_order').order('updated_at', { ascending: false })
  return data || []
}
// Sidebar / viewer nav: published, role-visible (RLS also enforces this).
export async function listNavPages() {
  const { data } = await supabase.from('infohub_pages')
    .select('id, slug, title, icon, category_id, pinned, mandatory, sort_order')
    .eq('status', 'published')
    .order('sort_order')
  return data || []
}

export async function loadPageBySlug(slug) {
  const { data } = await supabase.from('infohub_pages').select(PAGE_COLS).eq('slug', slug).maybeSingle()
  return data || null
}
export async function loadPageById(id) {
  const { data } = await supabase.from('infohub_pages').select(PAGE_COLS).eq('id', id).maybeSingle()
  return data || null
}

// ── Pages: mutations ──────────────────────────────────────────────────────────
export async function createPage({ title = 'Untitled page', blocks = [], category_id = null, icon = null } = {}) {
  const slug = await uniqueSlug(slugify(title))
  const { data } = await supabase.from('infohub_pages')
    .insert({ title, slug, draft: blocks, status: 'draft', category_id, icon })
    .select(PAGE_COLS).single()
  return data
}

export async function saveDraft(id, { title, draft, summary, icon, editorName }) {
  const patch = { updated_at: new Date().toISOString() }
  if (title !== undefined) patch.title = title
  if (draft !== undefined) patch.draft = draft
  if (summary !== undefined) patch.summary = summary
  if (icon !== undefined) patch.icon = icon
  if (editorName !== undefined) patch.updated_by_name = editorName
  const { error } = await supabase.from('infohub_pages').update(patch).eq('id', id)
  if (error) throw error
}

export async function publishPage(id, { note = '', editorId = null, editorName = '' } = {}) {
  const page = await loadPageById(id)
  if (!page) throw new Error('Page not found')
  const blocks = page.draft || []
  const now = new Date().toISOString()
  const { error } = await supabase.from('infohub_pages').update({
    published: blocks, status: 'published', published_at: now, updated_at: now,
    updated_by_name: editorName || page.updated_by_name,
  }).eq('id', id)
  if (error) throw error
  await supabase.from('infohub_revisions').insert({
    page_id: id, title: page.title, blocks, editor: editorId, editor_name: editorName, note: note || null,
  })
}

export async function unpublishPage(id) {
  await supabase.from('infohub_pages').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', id)
}
export async function setStatus(id, status) {
  await supabase.from('infohub_pages').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
}
export async function updatePageMeta(id, patch) {
  await supabase.from('infohub_pages').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}
export async function setSlug(id, title) {
  const slug = await uniqueSlug(slugify(title), id)
  await supabase.from('infohub_pages').update({ slug }).eq('id', id)
  return slug
}

export async function duplicatePage(id) {
  const p = await loadPageById(id)
  if (!p) return null
  const slug = await uniqueSlug(slugify(p.title) + '-copy')
  const { data } = await supabase.from('infohub_pages').insert({
    title: p.title + ' (copy)', slug, icon: p.icon, summary: p.summary, category_id: p.category_id,
    draft: p.draft || p.published || [], status: 'draft', tags: p.tags, visible_roles: p.visible_roles,
  }).select(PAGE_COLS).single()
  return data
}

export async function deletePage(id) {
  await supabase.from('infohub_pages').delete().eq('id', id)
}

// Persist a new ordering (array of page ids in order).
export async function reorderPages(ids) {
  await Promise.all(ids.map((id, i) => supabase.from('infohub_pages').update({ sort_order: i }).eq('id', id)))
}

// ── Revisions ─────────────────────────────────────────────────────────────────
export async function listRevisions(pageId) {
  const { data } = await supabase.from('infohub_revisions')
    .select('id, title, editor_name, note, created_at, blocks')
    .eq('page_id', pageId).order('created_at', { ascending: false })
  return data || []
}
export async function restoreRevision(pageId, revBlocks) {
  await supabase.from('infohub_pages').update({ draft: revBlocks, updated_at: new Date().toISOString() }).eq('id', pageId)
}

// ── Mandatory-reading acknowledgement ─────────────────────────────────────────
export async function getAck(pageId, userId) {
  if (!userId) return null
  const { data } = await supabase.from('infohub_acks').select('acknowledged_at').eq('page_id', pageId).eq('user_id', userId).maybeSingle()
  return data?.acknowledged_at || null
}
export async function acknowledgePage(pageId, userId) {
  await supabase.from('infohub_acks').upsert({ page_id: pageId, user_id: userId }, { onConflict: 'page_id,user_id' })
}
