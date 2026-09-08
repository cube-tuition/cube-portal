-- Additional-questions worksheets assigned to a lesson, for the teacher to
-- open as PDFs on the class › date page. The PDFs are SNAPSHOTS taken when
-- the sheet is assigned (worksheet + answer key), stored in a private bucket
-- and served through short-lived signed URLs, so what the teacher sees is
-- what was handed out even if the worksheet is edited later. Re-assign to
-- refresh. Keyed by class + date (not lessons.id) because the lesson page is.

create table if not exists public.lesson_worksheets (
  id              uuid primary key default gen_random_uuid(),
  class_id        text not null,
  lesson_date     date not null,
  worksheet_id    uuid references public.qbank_worksheets(id) on delete set null,
  title           text not null,
  worksheet_path  text not null,
  answers_path    text not null,
  assigned_by     text,
  created_at      timestamptz not null default now()
);
create index if not exists lesson_worksheets_lesson_idx on public.lesson_worksheets (class_id, lesson_date);

alter table public.lesson_worksheets enable row level security;
drop policy if exists lesson_worksheets_staff_select on public.lesson_worksheets;
create policy lesson_worksheets_staff_select on public.lesson_worksheets
  for select to authenticated using (public.is_staff());
drop policy if exists lesson_worksheets_staff_insert on public.lesson_worksheets;
create policy lesson_worksheets_staff_insert on public.lesson_worksheets
  for insert to authenticated with check (public.is_staff());
drop policy if exists lesson_worksheets_staff_delete on public.lesson_worksheets;
create policy lesson_worksheets_staff_delete on public.lesson_worksheets
  for delete to authenticated using (public.is_staff());

insert into storage.buckets (id, name, public, file_size_limit)
values ('lesson-worksheets', 'lesson-worksheets', false, 20971520)  -- 20 MB
on conflict (id) do nothing;

drop policy if exists "lesson_worksheets_staff_select" on storage.objects;
create policy "lesson_worksheets_staff_select" on storage.objects
  for select using (bucket_id = 'lesson-worksheets' and public.is_staff());
drop policy if exists "lesson_worksheets_staff_insert" on storage.objects;
create policy "lesson_worksheets_staff_insert" on storage.objects
  for insert with check (bucket_id = 'lesson-worksheets' and public.is_staff());
drop policy if exists "lesson_worksheets_staff_delete" on storage.objects;
create policy "lesson_worksheets_staff_delete" on storage.objects
  for delete using (bucket_id = 'lesson-worksheets' and public.is_staff());
