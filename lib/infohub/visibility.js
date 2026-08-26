/*
 * Who an Info Centre page is for. Two settings, not a free role picker:
 *
 *   Everyone  — every staff member: admins, directors and teachers.
 *   Director  — the directors only; teachers cannot open it or see it listed.
 *
 * Stored in `infohub_pages.visible_roles`, which the RLS policy already
 * enforces (`infohub_pages_read`: you may read a page if you can edit, or it
 * is published and your role is in visible_roles). Hiding it in the sidebar is
 * therefore presentation — the server refuses the row either way.
 *
 * Why "Director" keeps 'admin' in the list: no account actually carries a
 * 'director' JWT role. Both directors sign in as 'admin' (checked: 2 admin, 7
 * tutor, 0 director), so a page marked ['director'] would be invisible to
 * everybody including them. 'director' stays in the array so the setting still
 * means what it says if that role is ever issued.
 */
export const EVERYONE = ['admin', 'director', 'tutor']
export const DIRECTOR_ONLY = ['admin', 'director']

export const AUDIENCES = [
  { id: 'everyone', label: 'Everyone', hint: 'All staff — admins, directors and teachers', roles: EVERYONE },
  { id: 'director', label: 'Director', hint: 'Directors only — hidden from teachers', roles: DIRECTOR_ONLY },
]

// A page is director-only when teachers are not on its list.
export const isDirectorOnly = (page) => {
  const roles = page?.visible_roles
  if (!Array.isArray(roles) || roles.length === 0) return false   // unset = everyone
  return !roles.includes('tutor')
}

export const audienceOf = (page) => (isDirectorOnly(page) ? 'director' : 'everyone')
export const rolesFor = (audience) => (audience === 'director' ? DIRECTOR_ONLY : EVERYONE)
