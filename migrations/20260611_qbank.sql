-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Question Bank (qbank)
-- Run once in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
--
-- A SmarterEd-style question bank: a Year → Subject → Topic → Skill taxonomy,
-- LaTeX questions (single or multi-part) with attached images, used by tutors
-- to hand-pick questions and export worksheets + answer keys.
--
-- Lives entirely in the `qbank_` namespace so it never touches the existing
-- `topics` / `skills` / `booklets` tables. Seeds itself from the existing flat
-- `topics` lookup so prior work carries over.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ Taxonomy ════════════════════════════════════════════════════════════════
create table if not exists qbank_subjects (
  id          uuid primary key default gen_random_uuid(),
  year_level  int  not null,
  name        text not null,
  code        text,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists qbank_subjects_year_name_uniq
  on qbank_subjects(year_level, lower(name));

create table if not exists qbank_topics (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references qbank_subjects(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists qbank_topics_subject_idx on qbank_topics(subject_id);

create table if not exists qbank_skills (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references qbank_topics(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists qbank_skills_topic_idx on qbank_skills(topic_id);

-- ═══ Questions ═══════════════════════════════════════════════════════════════
create table if not exists qbank_questions (
  id             uuid primary key default gen_random_uuid(),
  skill_id       uuid not null references qbank_skills(id) on delete restrict,
  stem_latex     text not null default '',
  solution_latex text not null default '',      -- worked solution (answer key)
  difficulty     int  not null default 3 check (difficulty between 1 and 5),
  marks          int,
  is_multipart   boolean not null default false,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists qbank_questions_skill_idx on qbank_questions(skill_id);
create index if not exists qbank_questions_difficulty_idx on qbank_questions(difficulty);

create table if not exists qbank_question_parts (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references qbank_questions(id) on delete cascade,
  part_label     text,                          -- a, b, c …
  prompt_latex   text not null default '',
  solution_latex text not null default '',
  marks          int,
  sort_order     int  not null default 0
);
create index if not exists qbank_question_parts_question_idx on qbank_question_parts(question_id);

create table if not exists qbank_question_images (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid references qbank_questions(id) on delete cascade,
  part_id      uuid references qbank_question_parts(id) on delete cascade,
  storage_path text not null,                   -- path within the qbank-images bucket
  alt          text,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists qbank_question_images_question_idx on qbank_question_images(question_id);
create index if not exists qbank_question_images_part_idx on qbank_question_images(part_id);

-- Keep updated_at fresh on edit
create or replace function qbank_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists qbank_questions_touch on qbank_questions;
create trigger qbank_questions_touch before update on qbank_questions
  for each row execute function qbank_touch_updated_at();

-- ═══ Storage bucket for question images ══════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('qbank-images', 'qbank-images', true)
on conflict (id) do nothing;

drop policy if exists "qbank_images_read"   on storage.objects;
drop policy if exists "qbank_images_insert" on storage.objects;
drop policy if exists "qbank_images_update" on storage.objects;
drop policy if exists "qbank_images_delete" on storage.objects;

create policy "qbank_images_read"   on storage.objects for select
  using (bucket_id = 'qbank-images');
create policy "qbank_images_insert" on storage.objects for insert
  with check (bucket_id = 'qbank-images');
create policy "qbank_images_update" on storage.objects for update
  using (bucket_id = 'qbank-images');
create policy "qbank_images_delete" on storage.objects for delete
  using (bucket_id = 'qbank-images');

-- ═══ Seed taxonomy ═══════════════════════════════════════════════════════════
-- 1. Subjects from existing flat `topics` (year, subject)
insert into qbank_subjects (year_level, name, sort_order)
select distinct t.year, t.subject, 0
from topics t
where t.year is not null and t.subject is not null
  and not exists (
    select 1 from qbank_subjects s
    where s.year_level = t.year and lower(s.name) = lower(t.subject)
  );

-- 2. Common subjects per year (Years 7–12), incl. senior maths streams
insert into qbank_subjects (year_level, name)
select y, n from (values
  (7,'Maths'),(7,'English'),
  (8,'Maths'),(8,'English'),
  (9,'Maths'),(9,'English'),
  (10,'Maths'),(10,'English'),
  (11,'English'),(11,'Standard Maths'),(11,'Adv Maths'),(11,'Ext 1 Maths'),(11,'Chemistry'),
  (12,'English'),(12,'Standard Maths'),(12,'Adv Maths'),(12,'Ext 1 Maths'),(12,'Ext 2 Maths'),(12,'Chemistry')
) v(y,n)
where not exists (
  select 1 from qbank_subjects s where s.year_level = v.y and lower(s.name) = lower(v.n)
);

-- 3. Topics carried over from existing flat `topics`
insert into qbank_topics (subject_id, name)
select s.id, t.name
from topics t
join qbank_subjects s
  on s.year_level = t.year and lower(s.name) = lower(t.subject)
where not exists (
  select 1 from qbank_topics qt
  where qt.subject_id = s.id and lower(qt.name) = lower(t.name)
);
