-- Two things the exam builder could not put in a question.
--
-- math_obj: a code-drawn figure (Cartesian plane, number line, box plot,
-- histogram, dot plot, stem-and-leaf, xy table) — the same object the booklet
-- builder attaches to a question block, in the same shape, so one editor and
-- one renderer serve both. Null = no figure.
--
-- stimulus_latex: a passage, extract or source printed above the question, for
-- English papers where the questions are about a text the student is given.
alter table public.qbank_questions
  add column if not exists math_obj jsonb,
  add column if not exists stimulus_latex text;

comment on column public.qbank_questions.math_obj is
  'Code-drawn figure for this question, same shape as a booklet block''s mathObj. Null = none.';
comment on column public.qbank_questions.stimulus_latex is
  'Passage or source text printed above the question stem (English papers). Null = none.';
