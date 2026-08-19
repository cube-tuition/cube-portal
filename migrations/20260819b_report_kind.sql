-- Mid-term reports sit alongside end-of-term ones, and each needs its own
-- teacher comment and its own criteria grades. Both tables were unique on
-- (student, class, term), so a mid-term comment would have collided with — and
-- on save, overwritten — the end-of-term one.
--
-- Everything written before today is an end-of-term comment, which is exactly
-- what the default backfills existing rows to.

alter table public.term_comments
  add column if not exists kind text not null default 'end_of_term';
alter table public.term_criteria
  add column if not exists kind text not null default 'end_of_term';

do $$ begin
  alter table public.term_comments add constraint term_comments_kind_check
    check (kind in ('mid_term', 'end_of_term'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.term_criteria add constraint term_criteria_kind_check
    check (kind in ('mid_term', 'end_of_term'));
exception when duplicate_object then null; end $$;

-- Widen the uniqueness to include the report kind.
alter table public.term_comments
  drop constraint if exists term_comments_student_id_class_id_term_id_key;
alter table public.term_criteria
  drop constraint if exists term_criteria_class_id_term_id_student_id_key;

do $$ begin
  alter table public.term_comments add constraint term_comments_student_class_term_kind_key
    unique (student_id, class_id, term_id, kind);
exception when duplicate_table then null; end $$;
do $$ begin
  alter table public.term_criteria add constraint term_criteria_class_term_student_kind_key
    unique (class_id, term_id, student_id, kind);
exception when duplicate_table then null; end $$;

comment on column public.term_comments.kind is
  'Which report this comment belongs to: mid_term or end_of_term.';
comment on column public.term_criteria.kind is
  'Which report these grades belong to: mid_term or end_of_term.';
