-- Class prep: a second tick per lesson — the materials are printed. A row now
-- holds either tick (or both); it is deleted when both are cleared.
alter table public.lesson_prep
  alter column prepared_at drop not null,
  alter column prepared_at drop default,
  add column if not exists printed_at timestamptz,
  add column if not exists printed_by_name text;
