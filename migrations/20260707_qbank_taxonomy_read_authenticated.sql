-- Students' worksheet builder (/resources) reads the qbank taxonomy to populate
-- the Subject/Topics pickers, but these tables only had staff_all policies, so
-- students saw an empty Subject dropdown. Give authenticated users read access,
-- matching the existing read_authenticated policy on qbank_questions.

create policy read_authenticated on public.qbank_subjects
  for select to authenticated using (true);

create policy read_authenticated on public.qbank_topics
  for select to authenticated using (true);

create policy read_authenticated on public.qbank_subtopics
  for select to authenticated using (true);

create policy read_authenticated on public.qbank_skills
  for select to authenticated using (true);
