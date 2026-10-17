-- Students can see which inquiry questions / subtopics their practice
-- questions are filed under, so the practice page can narrow a module down to
-- one inquiry question.
--
-- qbank_question_subtopics was staff-only, which left the practice page only
-- the question's single primary subtopic. A student may now read the tags of
-- any question they can read — the qbank_questions policy (their enrolled
-- subjects' practice questions, never exam ones) decides which, because the
-- subquery runs under the student's own row-level security.

create policy students_read_practice_tags on public.qbank_question_subtopics
  for select to authenticated
  using (exists (select 1 from public.qbank_questions q where q.id = question_id));

-- The test database covers the subtopic tables (tests/access.db.test.mjs).
insert into public.test_snapshot_objects (kind, name, ord)
select 'table', v.name, coalesce((select max(ord) from public.test_snapshot_objects where kind = 'table'), 0) + v.n
  from (values ('qbank_subtopics', 1), ('qbank_question_subtopics', 2)) v(name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = 'table' and o.name = v.name);
