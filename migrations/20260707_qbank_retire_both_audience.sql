-- Retire the 'both' audience for question-bank questions. A question is now
-- either CUBE-only ('exam') or student-practice-only ('student'). Existing
-- 'both' questions become CUBE ('exam').
update public.qbank_questions set audience = 'exam' where audience = 'both';

alter table public.qbank_questions drop constraint if exists qbank_questions_audience_check;
alter table public.qbank_questions
  add constraint qbank_questions_audience_check
  check (audience = any (array['exam'::text, 'student'::text]));
