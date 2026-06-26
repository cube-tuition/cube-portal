-- Difficulty scale is now 1-4 (1=Easy, 2=Medium, 3=Hard, 4=Very hard).
-- Shift the existing 2-5 values down by one.
update public.qbank_questions  set difficulty = difficulty - 1 where difficulty between 2 and 5;
update public.qbank_exam_slots set difficulty = difficulty - 1 where difficulty between 2 and 5;
