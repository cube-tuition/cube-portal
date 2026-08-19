-- Skills belong to QUESTIONS, not workbooks.
--
-- A workbook carried a free-text `skill` alongside its topic, chosen from a
-- per-year/subject `skills` bank. It duplicated the real thing: qbank tags a
-- skill on each QUESTION (qbank_skills + qbank_question_skills), which is the
-- grain a skill actually has — a workbook covers many. The workbook field was
-- never adopted: 0 of 156 booklets had one set.
--
-- qbank_skills / qbank_question_skills are untouched.
--
-- The bank's five rows, recorded here so nothing is lost to history:
--   Year 5  Maths — Graphing
--   Year 10 Maths — Graphing, Problem Solving, Unit Conversion, Working out

alter table public.booklets drop column if exists skill;
drop table if exists public.skills;
