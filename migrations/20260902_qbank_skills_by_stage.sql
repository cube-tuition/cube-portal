-- Skills become stage-scoped instead of year-scoped.
--
-- They used to hang off one year's subject row, and under one of that year's
-- topics and subtopics, so Year 8 and Year 9 could never share a skill even
-- when the skill was the same. A skill now belongs to a (family, stage) pair:
-- every year in that stage shares one list.
--
--   primary  Years 5-6
--   high     Years 7-12
--
-- The old subject_id / topic_id / subtopic_id columns stay on the table so the
-- restore script can put the previous rows back, but new skills leave them null:
-- nothing reads skillsByTopic or skillsBySubtopic, and every question already
-- carries its own topic_id or subtopic_id, so no question's topic was ever
-- resolved through its skill.
alter table public.qbank_skills
  add column if not exists family text,
  add column if not exists stage  text;

alter table public.qbank_skills drop constraint if exists qbank_skills_stage_check;
alter table public.qbank_skills add constraint qbank_skills_stage_check
  check (stage is null or stage in ('primary', 'high'));

alter table public.qbank_skills drop constraint if exists qbank_skills_family_check;
alter table public.qbank_skills add constraint qbank_skills_family_check
  check (family is null or family in ('Maths', 'English', 'Chemistry'));

-- A name appears once per list, case-insensitively, so the same skill cannot be
-- added twice from two different years now that they share the list.
create unique index if not exists qbank_skills_family_stage_name_key
  on public.qbank_skills (family, stage, lower(name))
  where family is not null and stage is not null;

create index if not exists qbank_skills_scope_idx
  on public.qbank_skills (family, stage, sort_order);

-- The 72 year-scoped skills were cleared with the change, along with their
-- question links. Undo with 20260902_qbank_skills_backup_restore.sql.
delete from public.qbank_question_skills;
update public.qbank_questions set skill_id = null where skill_id is not null;
delete from public.qbank_skills;
