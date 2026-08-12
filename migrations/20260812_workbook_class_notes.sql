-- Teacher annotations on the online workbook text itself (definition boxes,
-- explanations…), broadcast to the whole class: one set per (booklet, class),
-- painted on every student's copy and kept live over realtime.
create table public.workbook_class_notes (
  id          uuid primary key default gen_random_uuid(),
  booklet_id  uuid not null,
  class_id    bigint not null,
  block_id    text not null,
  range_start int  not null,
  range_end   int  not null,
  quote       text,
  body        text not null,
  author_id   uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index workbook_class_notes_scope_idx
  on public.workbook_class_notes (booklet_id, class_id);

alter table public.workbook_class_notes enable row level security;

-- Staff write and read everything (same rule as workbook_comments).
create policy staff_all on public.workbook_class_notes
  for all to authenticated using (is_staff()) with check (is_staff());

-- Students read the annotations for classes they are actively enrolled in.
create policy class_read on public.workbook_class_notes
  for select to authenticated
  using (exists (
    select 1 from public.enrolments e
    where e.class_id = workbook_class_notes.class_id
      and e.student_id = auth.uid()
      and e.status = 'active'
  ));

-- Live updates on every open copy.
alter publication supabase_realtime add table public.workbook_class_notes;
