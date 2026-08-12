-- The teacher's class workbook: answers typed on the Workbook tab, one set per
-- (booklet, class), shown live on every student's copy as a read-only
-- "Teacher's working" panel under the matching answer box.
create table public.workbook_model_answers (
  id          uuid primary key default gen_random_uuid(),
  booklet_id  uuid not null,
  class_id    bigint not null,
  block_id    text not null,
  part_id     text not null default '',
  body        text not null default '',
  author_id   uuid,
  updated_at  timestamptz not null default now(),
  unique (booklet_id, class_id, block_id, part_id)
);

alter table public.workbook_model_answers enable row level security;

create policy staff_all on public.workbook_model_answers
  for all to authenticated using (is_staff()) with check (is_staff());

create policy class_read on public.workbook_model_answers
  for select to authenticated
  using (exists (
    select 1 from public.enrolments e
    where e.class_id = workbook_model_answers.class_id
      and e.student_id = auth.uid()
      and e.status = 'active'
  ));

alter publication supabase_realtime add table public.workbook_model_answers;
