-- Ad-hoc lessons (1:1 / level test) added in the explorer aren't tied to a class,
-- so class_id must allow NULL.
alter table public.lessons
  alter column class_id drop not null;
