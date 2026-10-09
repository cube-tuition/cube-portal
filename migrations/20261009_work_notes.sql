-- Meeting notes for the Work page (/tutor/admin/work) — the directors'
-- running record: meeting notes, decisions, follow-ups. Tasks/due dates live
-- in the existing ops_tasks table; this holds the prose.
create table if not exists public.work_notes (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default '',
  body         text not null default '',
  meeting_date date not null default current_date,
  created_by   text,                              -- author's name, like ops_tasks
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.work_notes enable row level security;
-- Directors only — meeting notes are not staff-wide reading.
drop policy if exists work_notes_admin_all on public.work_notes;
create policy work_notes_admin_all on public.work_notes
  for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
