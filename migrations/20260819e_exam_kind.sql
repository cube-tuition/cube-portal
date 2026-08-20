-- Mid-term tests sit alongside term tests, in the same format and built in the
-- same exam builder — they are simply a separate set of papers, listed under
-- their own tab so a mid-term is never mistaken for the end-of-term paper.
--
-- Same shape as the mid-term/end-of-term split already made for reports
-- (20260819b_report_kind): a `kind` column with a default that backfills every
-- existing row to what it already was. Every exam written before today is a
-- term test, which is exactly what the default gives them.
--
-- The vocabulary is 'term' rather than 'end_of_term' because that is what the
-- existing tab is called: a term test IS the end-of-term paper here.

alter table public.qbank_exams
  add column if not exists kind text not null default 'term';

do $$ begin
  alter table public.qbank_exams add constraint qbank_exams_kind_check
    check (kind in ('term', 'mid_term'));
exception when duplicate_object then null; end $$;

comment on column public.qbank_exams.kind is
  'Which set of papers this exam belongs to: term (end-of-term) or mid_term.';
