-- The paper's own year, kept separate from its name so a tracker can be read
-- by coverage ("which years have I done?") rather than by string matching.
-- `paper` now holds just the kind: HSC, CSSA Trial, Independent Trial…
alter table public.past_paper_attempts add column paper_year int;
create index past_paper_attempts_year_idx
  on public.past_paper_attempts (student_id, paper_year desc);
