-- Report exclusions are per (term, student, class) — with no notion of which
-- report. Excluding a student from the mid-term email would therefore also
-- have excluded them from the end-of-term one.
--
-- email_template_overrides already keys on email_type, so per-family custom
-- bodies separate on their own and need no change here.

alter table public.email_report_exclusions
  add column if not exists kind text not null default 'end_of_term';

do $$ begin
  alter table public.email_report_exclusions add constraint email_report_exclusions_kind_check
    check (kind in ('mid_term', 'end_of_term'));
exception when duplicate_object then null; end $$;

alter table public.email_report_exclusions
  drop constraint if exists email_report_exclusions_term_id_student_id_class_id_key;

do $$ begin
  alter table public.email_report_exclusions
    add constraint email_report_exclusions_term_student_class_kind_key
    unique (term_id, student_id, class_id, kind);
exception when duplicate_table then null; end $$;

comment on column public.email_report_exclusions.kind is
  'Which report this exclusion applies to: mid_term or end_of_term.';
