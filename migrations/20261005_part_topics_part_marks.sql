-- Exams are marked by subquestion, and each subquestion can sit under its own
-- topic.
--
-- A question like "(a) find the gradient (b) solve the simultaneous
-- equations" tests two topics, but its marks rolled up under one, so the topic
-- analysis blamed the whole question on whichever topic it was filed under.
--
-- qbank_question_parts.topic_id / subtopic_id: the part's own topic. Both null
-- means the part falls under the question's topic. A subtopic implies its
-- topic; topic_id alone is a part tagged to a topic with no subtopic.
alter table public.qbank_question_parts
  add column if not exists topic_id uuid references public.qbank_topics(id) on delete set null,
  add column if not exists subtopic_id uuid references public.qbank_subtopics(id) on delete set null;

comment on column public.qbank_question_parts.topic_id is
  'Topic this subquestion is analysed under; null (with subtopic_id null) = the question''s topic.';
comment on column public.qbank_question_parts.subtopic_id is
  'Subtopic this subquestion is analysed under; implies its topic.';

-- exam_question_marks.part_marks: a multi-part question's mark per part, keyed
-- by part label ({"a": 2, "b": 1}). Labels, not part ids — the question editor
-- re-creates parts on every save, so ids do not survive an edit; labels do.
-- awarded stays the question total (sum of the parts). A row with awarded but
-- no part_marks was marked as a whole before marking by part existed, and
-- still counts, under the question's topic.
alter table public.exam_question_marks
  add column if not exists part_marks jsonb;

comment on column public.exam_question_marks.part_marks is
  'Per-subquestion marks keyed by part label, e.g. {"a":2,"b":1}; awarded is their sum. Null = marked as a whole question.';
