-- Marks split into the two sections a paper actually has. `mark`/`total` stay
-- as the paper total: it is what a student reads off the front page, and a
-- paper with no MCQ section (English) simply leaves the MCQ pair null.
alter table public.past_paper_attempts
  add column mcq_mark      numeric,
  add column mcq_total     numeric,
  add column written_mark  numeric,
  add column written_total numeric;
