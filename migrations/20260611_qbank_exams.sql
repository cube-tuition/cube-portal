-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Saved exams (plan → fill → export)
-- Run once in Supabase SQL Editor.
--
-- An exam is planned (topic scope + sections with a question count and a marks
-- limit each), which lays out empty question "slots". Each slot is then tagged
-- with a topic/skill/difficulty and filled with a matching bank question.
-- Exams persist so they can be reopened, tweaked and re-exported.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists qbank_exams (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled exam',
  year_label   text,
  subject_id   uuid references qbank_subjects(id) on delete set null,
  term         text,
  reading_time text default '5 minutes',
  working_time text default '60 minutes',
  calculators  boolean not null default true,
  topic_ids    jsonb  not null default '[]'::jsonb,   -- scope (array of qbank_topics ids)
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists qbank_exam_sections (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references qbank_exams(id) on delete cascade,
  sort_order     int  not null default 0,
  type           text not null default 'extended' check (type in ('mcq','extended')),
  question_count int  not null default 0,
  marks_limit    int,
  allow_time     text
);
create index if not exists qbank_exam_sections_exam_idx on qbank_exam_sections(exam_id);

create table if not exists qbank_exam_slots (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references qbank_exam_sections(id) on delete cascade,
  sort_order  int  not null default 0,
  topic_id    uuid references qbank_topics(id) on delete set null,
  skill_id    uuid references qbank_skills(id) on delete set null,
  difficulty  int,
  question_id uuid references qbank_questions(id) on delete set null
);
create index if not exists qbank_exam_slots_section_idx on qbank_exam_slots(section_id);

-- reuses qbank_touch_updated_at() from the base qbank migration
drop trigger if exists qbank_exams_touch on qbank_exams;
create trigger qbank_exams_touch before update on qbank_exams
  for each row execute function qbank_touch_updated_at();
