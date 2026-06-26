-- "Very easy" (difficulty 1) is removed. Re-categorise anything rated 1 as
-- "Easy" (2). Difficulties are now 2=Easy, 3=Medium, 4=Hard, 5=Very hard.
update public.qbank_questions  set difficulty = 2 where difficulty = 1;
update public.qbank_exam_slots set difficulty = 2 where difficulty = 1;
