-- Persistent, independent timetable drafts. A draft is a saved scratch plan for a
-- term: an arrangement of class cards (entries) plus which ones are hidden. Drafts
-- never affect the live `classes` table — staff edit and resume them freely, and
-- only an explicit "Apply to live" pushes changes onto real classes.
create table if not exists public.timetable_drafts (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid references public.terms(id) on delete cascade,
  name        text not null default 'Untitled draft',
  entries     jsonb not null default '[]'::jsonb,   -- [{ id, class_name, course_id, teacher, room, day_of_week, start_time, end_time }]
  hidden_ids  jsonb not null default '[]'::jsonb,   -- [class_id, …] hidden in this draft
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists timetable_drafts_term_idx on public.timetable_drafts(term_id);

alter table public.timetable_drafts enable row level security;
drop policy if exists staff_all on public.timetable_drafts;
create policy staff_all on public.timetable_drafts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
