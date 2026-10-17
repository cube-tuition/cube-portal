-- Chemistry's question-bank inquiry questions come from the official syllabus.
--
-- The Topics page (qbank_topics / qbank_subtopics) is what the question bank
-- files questions under. For Chemistry a subtopic is one syllabus dot point
-- (its examples as indented "–" lines), shown as "Inquiry Questions". Rather
-- than type them by hand, they are copied from the master syllabus
-- (syllabus_dotpoints); this column records which dot point each came from, so
-- the list can be refreshed from the syllabus later without duplicating rows.
-- The copy itself is data, done by scripts/qbank-chem-syllabus.mjs.

alter table public.qbank_subtopics
  add column if not exists syllabus_dotpoint_id uuid references public.syllabus_dotpoints(id) on delete set null;

create unique index if not exists qbank_subtopics_topic_dotpoint_uniq
  on public.qbank_subtopics (topic_id, syllabus_dotpoint_id)
  where syllabus_dotpoint_id is not null;
