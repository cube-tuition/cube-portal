-- Class membership is a PERIOD, not a flag.
--
-- enrolments already recorded when a student LEFT (status 'disenrol' +
-- ended_at), and the per-session roll reads that as at the session date: the
-- weeks they attended still list them, later weeks don't. There was no matching
-- record of when they JOINED, so a student moved into a class mid-term appeared
-- on every roll back to week 1 of a class they had never sat in — and, on the
-- class they left, the deleted enrolment made them look like a make-up guest
-- for the weeks they had actually been enrolled.
--
-- started_at closes the other end of the period. NULL means "has been in this
-- class for as long as it has existed", which is true of every row created by
-- the term-transition wizard and of every row already in the table — so the
-- default leaves every existing roll exactly as it is.
alter table public.enrolments
  add column if not exists started_at date;

comment on column public.enrolments.started_at is
  'First date this student is on the class roll. NULL = since the class began. '
  'Set when a student joins part-way through a term; the mirror of ended_at.';
