-- Support a second document type (level tests) in the booklet builder.
-- doc_type marks a build as a 'booklet' (default) or 'level_test'.
-- cover holds the level-test cover config (title/subtitle, instructions[], totals[]).

alter table public.booklet_builds
  add column if not exists doc_type text not null default 'booklet',
  add column if not exists cover jsonb;
