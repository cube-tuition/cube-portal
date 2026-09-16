-- A section's own instruction line(s), printed under its marks and timing.
-- The header could only say the three things it computed — marks, the question
-- range and the allowed time — so anything else a section needed ("Answer in
-- the writing booklet", "Attempt BOTH questions") had nowhere to go.
alter table public.qbank_exam_sections
  add column if not exists note text;

comment on column public.qbank_exam_sections.note is
  'Free instruction text printed under the section heading; one line per newline. Null = none.';
