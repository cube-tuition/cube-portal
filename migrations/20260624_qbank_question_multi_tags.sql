-- Many-to-many tags for questions: multiple subtopics + multiple (independent)
-- skills, and for Chemistry multiple syllabus dotpoints (whole-year master list).
create table if not exists public.qbank_question_subtopics (
  question_id uuid not null references public.qbank_questions(id) on delete cascade,
  subtopic_id uuid not null references public.qbank_subtopics(id) on delete cascade,
  primary key (question_id, subtopic_id)
);
create table if not exists public.qbank_question_skills (
  question_id uuid not null references public.qbank_questions(id) on delete cascade,
  skill_id    uuid not null references public.qbank_skills(id) on delete cascade,
  primary key (question_id, skill_id)
);
create table if not exists public.qbank_question_dotpoints (
  question_id uuid not null references public.qbank_questions(id) on delete cascade,
  dotpoint_id uuid not null references public.syllabus_dotpoints(id) on delete cascade,
  primary key (question_id, dotpoint_id)
);
create index if not exists qqs_question_idx  on public.qbank_question_subtopics (question_id);
create index if not exists qqsk_question_idx on public.qbank_question_skills (question_id);
create index if not exists qqd_question_idx  on public.qbank_question_dotpoints (question_id);

alter table public.qbank_question_subtopics enable row level security;
alter table public.qbank_question_skills    enable row level security;
alter table public.qbank_question_dotpoints enable row level security;
drop policy if exists staff_all on public.qbank_question_subtopics;
drop policy if exists staff_all on public.qbank_question_skills;
drop policy if exists staff_all on public.qbank_question_dotpoints;
create policy staff_all on public.qbank_question_subtopics for all using (is_staff()) with check (is_staff());
create policy staff_all on public.qbank_question_skills    for all using (is_staff()) with check (is_staff());
create policy staff_all on public.qbank_question_dotpoints for all using (is_staff()) with check (is_staff());

-- Backfill from existing single columns.
insert into public.qbank_question_subtopics (question_id, subtopic_id)
  select id, subtopic_id from public.qbank_questions where subtopic_id is not null on conflict do nothing;
insert into public.qbank_question_skills (question_id, skill_id)
  select id, skill_id from public.qbank_questions where skill_id is not null on conflict do nothing;
