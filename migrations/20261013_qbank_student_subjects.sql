-- Students practise only the subjects they are enrolled in.
--
-- A student could read every non-exam question in the bank, so a Y12 Adv
-- student saw Ext 1 and Ext 2 questions on the Resources page. The rule is
-- now in the database: a practice question is visible to a student only when
-- its topic's subject (year level + stream, e.g. 12 / Adv Maths) matches a
-- class they are enrolled in (active or on trial, not ended). Staff still
-- read everything.
--
-- Which question-bank subject a class belongs to comes from its course code
-- (12.M2C → year 12, Adv Maths — the same rule as lib/courses.js), falling
-- back to the class name for classes with no course.

create or replace function public.qbank_subject_key(p_course_code text, p_class_name text)
returns table(year_level integer, subject_name text)
language sql immutable as $$
  with parts as (
    select nullif(split_part(coalesce(p_course_code, ''), '.', 1), '') as y,
           upper(split_part(coalesce(p_course_code, ''), '.', 2)) as sfx,
           lower(coalesce(p_class_name, '')) as nm
  ), yr as (
    select case when y ~ '^\d+$' then y::int
                else nullif((regexp_match(nm, 'y(?:ear)?\s*(\d{1,2})'))[1], '')::int end as year_level,
           sfx, nm
    from parts
  ), by_code as (
    select year_level, nm,
      case
        when year_level >= 11 and sfx like 'M1%' then 'Standard Maths'
        when year_level >= 11 and sfx like 'M2%' then 'Adv Maths'
        when year_level >= 11 and sfx like 'M3%' then 'Ext 1 Maths'
        when year_level >= 11 and sfx like 'M4%' then 'Ext 2 Maths'
        when sfx like 'M%' then 'Maths'
        when sfx like 'E%' then 'English'
        when sfx like 'C%' then 'Chemistry'
        when sfx like 'P%' then 'Physics'
        when sfx like 'S%' then 'Science'
        else null
      end as subject_name
    from yr
  )
  -- The course code names one subject; the class name can add a second — a
  -- combined "Ext 1/2" 1:1 is coded as Ext 2 but teaches both.
  select distinct year_level, subject_name from (
    select year_level, subject_name from by_code
    union all
    select year_level, 'Ext 1 Maths' from by_code where nm like '%ext 1%' or nm like '%extension 1%'
    union all
    select year_level, 'Ext 2 Maths' from by_code where nm like '%ext 2%' or nm like '%extension 2%'
    union all
    select year_level,
      case
        when nm like '%standard%' then 'Standard Maths'
        when nm like '%adv%' then 'Adv Maths'
        when nm like '%chem%' then 'Chemistry'
        when nm like '%physics%' then 'Physics'
        when nm like '%english%' or nm like '%eald%' then 'English'
        when nm like '%science%' then 'Science'
        when nm like '%math%' then case when year_level >= 11 then 'Adv Maths' else 'Maths' end
        else null
      end
    from by_code where subject_name is null
  ) k
  where year_level is not null and subject_name is not null
$$;

-- The question-bank subjects a student may practise: one per enrolled class.
create or replace function public.student_qbank_subject_ids(p_student uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct s.id
  from public.enrolments e
  join public.classes c on c.id = e.class_id
  left join public.courses co on co.id = c.course_id
  cross join lateral public.qbank_subject_key(co.course_code, c.class_name) k
  join public.qbank_subjects s on s.year_level = k.year_level and lower(s.name) = lower(k.subject_name)
  where e.student_id = p_student
    and e.status in ('active', 'trial') and e.ended_at is null
$$;

-- Can the signed-in student see this question? Never an exam question; a
-- practice question only in a subject they are enrolled in. SECURITY DEFINER
-- so the policies below never evaluate each other.
create or replace function public.qbank_question_open_to_student(p_question uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.qbank_questions q
    left join public.qbank_skills sk on sk.id = q.skill_id
    join public.qbank_topics t on t.id = coalesce(q.topic_id, sk.topic_id)
    where q.id = p_question
      and coalesce(q.audience, 'student') <> 'exam'
      and t.subject_id in (select public.student_qbank_subject_ids(auth.uid()))
  )
$$;

drop policy if exists qbank_questions_read on public.qbank_questions;
create policy qbank_questions_read on public.qbank_questions
  for select to authenticated
  using (public.is_staff() or public.qbank_question_open_to_student(id));

drop policy if exists qbank_question_parts_read on public.qbank_question_parts;
create policy qbank_question_parts_read on public.qbank_question_parts
  for select to authenticated
  using (public.is_staff() or public.qbank_question_open_to_student(question_id));

drop policy if exists qbank_question_images_read on public.qbank_question_images;
create policy qbank_question_images_read on public.qbank_question_images
  for select to authenticated
  using (public.is_staff() or public.qbank_question_open_to_student(question_id));

-- Cover the rule in tests/access.db.test.mjs: the taxonomy tables and the
-- three functions join the schema snapshot.
insert into public.test_snapshot_objects (kind, name, ord) values
  ('table', 'qbank_subjects', 29),
  ('table', 'qbank_topics', 30),
  ('table', 'qbank_skills', 31),
  ('function', 'qbank_subject_key', 34),
  ('function', 'student_qbank_subject_ids', 35),
  ('function', 'qbank_question_open_to_student', 36)
on conflict (kind, name) do nothing;
