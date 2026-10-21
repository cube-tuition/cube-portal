-- Class prep: the directors tick off each lesson once its materials are ready
-- (the Action Centre's Class prep card, lib/classPrep). One row per prepared
-- lesson; unticking deletes it. Directors only — tutors and students see none.
create table if not exists public.lesson_prep (
  lesson_id        integer primary key references public.lessons(id) on delete cascade,
  prepared_by      uuid,
  prepared_by_name text,
  prepared_at      timestamptz not null default now()
);
alter table public.lesson_prep enable row level security;
drop policy if exists lesson_prep_admin on public.lesson_prep;
create policy lesson_prep_admin on public.lesson_prep for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

insert into public.test_snapshot_objects (kind, name, ord)
select 'table', 'lesson_prep', coalesce((select max(ord) from public.test_snapshot_objects where kind = 'table'), 0) + 1
 where not exists (select 1 from public.test_snapshot_objects where kind = 'table' and name = 'lesson_prep');
