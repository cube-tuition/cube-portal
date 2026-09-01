-- Tag an additional-questions worksheet with the curriculum topic it belongs to,
-- so it surfaces on that topic's page under Materials.
--
-- References topics(id) rather than the qbank's own topic tree: the Materials
-- pages are driven by the curriculum topics table, and that is the list a tutor
-- is choosing from. ON DELETE SET NULL so removing a topic un-files its
-- worksheets rather than deleting them.
alter table public.qbank_worksheets
  add column if not exists topic_id integer
  references public.topics(id) on delete set null;

create index if not exists qbank_worksheets_topic_id_idx
  on public.qbank_worksheets (topic_id) where topic_id is not null;
