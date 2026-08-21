-- Per-paper page-break control for exam questions, set in the exam builder.
-- Same shape as working_lines: keys are part labels, plus "_" for the question
-- itself. { "_": true, "c": true } = this question starts on a fresh page, and
-- so does its part (c). Absent/null = let pagination flow normally.
alter table public.qbank_exam_slots
  add column if not exists page_breaks jsonb;

comment on column public.qbank_exam_slots.page_breaks is
  'Forced page breaks: { "_"|part_label: true }. "_" breaks before the question.';
