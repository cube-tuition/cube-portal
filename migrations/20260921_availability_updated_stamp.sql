-- When did this tutor last change their availability?
--
-- teacher_availability is one row per (tutor, day, slot) and a slot is REMOVED
-- by deleting its row, so max(created_at) can't answer the question: a tutor
-- who spent Sunday trimming their hours, or who pressed "Clear all", leaves no
-- newer row behind — and no row at all in the second case.
--
-- So the answer is stamped on the tutor: set on every change from either the
-- tutor's own Availability page or the director's Availabilities grid, with
-- the name of whoever saved it, so "updated last week" can't quietly mean
-- "a director fixed it last week".
alter table tutors
  add column if not exists availability_updated_at timestamptz,
  add column if not exists availability_updated_by text;

comment on column tutors.availability_updated_at is
  'Last time this tutor''s availability was changed (by anyone). Null = never since the stamp existed.';
comment on column tutors.availability_updated_by is
  'Full name of whoever saved that change. Null for rows backfilled from teacher_availability.created_at.';

-- Backfill from the newest row each tutor still has. It under-reports anyone
-- whose last act was a removal, which is why it leaves _by null: we know when
-- something was last ADDED, not who last touched it.
update tutors t
   set availability_updated_at = a.last_added
  from (select tutor_id, max(created_at) as last_added
          from teacher_availability group by tutor_id) a
 where a.tutor_id = t.id
   and t.availability_updated_at is null;
