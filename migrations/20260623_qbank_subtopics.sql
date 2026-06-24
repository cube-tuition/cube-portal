-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Question Bank: Subtopics
-- Run once in Supabase SQL Editor (already applied to production via MCP).
--
-- Adds a Subtopic level between Topic and Skill, so the taxonomy becomes
--   Subject → Topic → Subtopic → Skill → Question
--
-- subtopic_id is denormalised onto qbank_skills, qbank_questions and
-- qbank_exam_slots (mirroring the existing denormalised topic_id), so the
-- topic-level exam analysis / reports keep resolving topic via skill.topic_id
-- and are completely unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists qbank_subtopics (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references qbank_topics(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists qbank_subtopics_topic_idx on qbank_subtopics(topic_id);

alter table qbank_skills     add column if not exists subtopic_id uuid references qbank_subtopics(id) on delete set null;
alter table qbank_questions  add column if not exists subtopic_id uuid references qbank_subtopics(id) on delete set null;
alter table qbank_exam_slots add column if not exists subtopic_id uuid references qbank_subtopics(id) on delete set null;
create index if not exists qbank_skills_subtopic_idx    on qbank_skills(subtopic_id);
create index if not exists qbank_questions_subtopic_idx on qbank_questions(subtopic_id);

-- RLS: match qbank_topics / qbank_skills (staff full access).
alter table qbank_subtopics enable row level security;
drop policy if exists staff_all on qbank_subtopics;
create policy staff_all on qbank_subtopics for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- One "General" subtopic per topic, then file existing skills + questions under
-- it so every record has a subtopic (subtopic is required going forward).
insert into qbank_subtopics (topic_id, name, sort_order)
select t.id, 'General', 0 from qbank_topics t
where not exists (
  select 1 from qbank_subtopics st where st.topic_id = t.id and lower(st.name) = 'general'
);

update qbank_skills s
set subtopic_id = st.id
from qbank_subtopics st
where st.topic_id = s.topic_id and lower(st.name) = 'general'
  and s.subtopic_id is null;

-- Questions tagged via a skill: use the skill's topic.
update qbank_questions q
set subtopic_id = st.id
from qbank_skills sk
join qbank_subtopics st on st.topic_id = sk.topic_id and lower(st.name) = 'general'
where q.skill_id = sk.id and q.subtopic_id is null;

-- Questions tagged only by a denormalised topic_id (no skill).
update qbank_questions q
set subtopic_id = st.id
from qbank_subtopics st
where q.skill_id is null and q.topic_id is not null
  and st.topic_id = q.topic_id and lower(st.name) = 'general'
  and q.subtopic_id is null;
