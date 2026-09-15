-- Per-paper figure size for an exam question, set in the exam builder.
-- A whole-number percentage of the text column (10–100) applied to every image
-- of the slot's question on that paper. Null = the renderer's automatic size
-- (a 300px box, or 460px for a figure the student draws on).
alter table public.qbank_exam_slots
  add column if not exists image_width integer
  check (image_width is null or (image_width between 10 and 100));

comment on column public.qbank_exam_slots.image_width is
  'Figure width for this paper as % of the text column (10–100). Null = automatic.';
