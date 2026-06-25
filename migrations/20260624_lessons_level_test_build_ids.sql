-- A level-test lesson can link to several level tests; store them as an array.
-- level_test_build_id (single) is kept populated with the first for back-compat.
alter table public.lessons
  add column if not exists level_test_build_ids uuid[];
