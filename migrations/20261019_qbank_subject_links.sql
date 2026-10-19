-- A subject can show another subject's topics alongside its own.
--
-- Year 11 Ext 1 overlaps heavily with Year 11 Adv, so Ext 1 lists its own
-- topics (Further Functions, Further Trigonometry, Permutations and
-- combinations, Binomial theorem) AND Year 11 Adv's — the same rows, not
-- copies. The question bank, editor, exam builder, worksheets and practice
-- page read this through lib/qbank fetchTaxonomy; the Topics page shows the
-- linked topics under "From Year 11 Adv".
--
-- An Ext 1 enrolment therefore also opens Year 11 Adv's practice questions:
-- student_qbank_subject_ids adds the subjects a student's subjects link to.

create table if not exists public.qbank_subject_links (
  subject_id       uuid not null references public.qbank_subjects(id) on delete cascade,
  shows_subject_id uuid not null references public.qbank_subjects(id) on delete cascade,
  primary key (subject_id, shows_subject_id),
  check (subject_id <> shows_subject_id)
);
alter table public.qbank_subject_links enable row level security;
create policy read_authenticated on public.qbank_subject_links for select to authenticated using (true);
create policy admin_write on public.qbank_subject_links for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

insert into public.qbank_subject_links (subject_id, shows_subject_id)
select e.id, a.id from public.qbank_subjects e join public.qbank_subjects a on a.year_level = e.year_level
 where e.year_level = 11 and e.name = 'Ext 1 Maths' and a.name = 'Adv Maths'
on conflict do nothing;

create or replace function public.student_qbank_subject_ids(p_student uuid)
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with direct as (
    select distinct s.id
    from public.enrolments e
    join public.classes c on c.id = e.class_id
    left join public.courses co on co.id = c.course_id
    cross join lateral public.qbank_subject_key(co.course_code, c.class_name) k
    join public.qbank_subjects s on s.year_level = k.year_level and lower(s.name) = lower(k.subject_name)
    where e.student_id = p_student
      and e.status in ('active', 'trial') and e.ended_at is null
  )
  select id from direct
  union
  -- A linked subject comes with it (Year 11 Ext 1 → Year 11 Adv).
  select l.shows_subject_id from public.qbank_subject_links l join direct d on d.id = l.subject_id
$function$;

insert into public.test_snapshot_objects (kind, name, ord)
select 'table', 'qbank_subject_links', coalesce((select max(ord) from public.test_snapshot_objects where kind = 'table'), 0) + 1
 where not exists (select 1 from public.test_snapshot_objects where kind = 'table' and name = 'qbank_subject_links');
