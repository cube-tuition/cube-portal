-- Student flags — raised by a tutor from the lesson page when something about a
-- student needs a director's attention (missed homework again, a behaviour
-- incident, a concept they clearly haven't got, a wellbeing worry).
--
-- One row per flag. Flags stay `open` until a director resolves them, which is
-- what keeps them in the Action Centre; resolving is a status change, never a
-- delete, so the per-student history on /tutor/flags stays complete.
--
-- class_id is bigint to match public.classes.id (NOT a uuid); student_id is a
-- uuid matching public.students.id. Both are left unconstrained by FKs, in
-- keeping with the rest of the schema, so a deleted class never destroys the
-- record of a flag.

create table if not exists public.student_flags (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null,
  student_name   text not null,          -- denormalised: the flag must stay readable
  class_id       bigint,                 -- null when raised outside a class context
  class_name     text,
  lesson_date    date,                   -- the session it was raised from
  reason         text not null
                 check (reason in ('attendance','homework','behaviour',
                                   'understanding','engagement','wellbeing','other')),
  note           text,
  raised_by      uuid,                   -- staff auth uid
  raised_by_name text,
  status         text not null default 'open' check (status in ('open','resolved')),
  resolution     text,                   -- what was done about it
  resolved_by    uuid,
  resolved_by_name text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- The Action Centre asks for open flags newest-first on every load.
create index if not exists student_flags_open_idx
  on public.student_flags (status, created_at desc);
-- The per-student history panel on /tutor/flags.
create index if not exists student_flags_student_idx
  on public.student_flags (student_id, created_at desc);

alter table public.student_flags enable row level security;

-- is_staff() = role in (admin, tutor, director). Tutors raise flags; directors
-- resolve them. The Action Centre and /tutor/flags self-gate to directors in
-- the UI, so tutors reading the table back is intentional (they see the flags
-- they raised, and whether anything came of them).
drop policy if exists staff_all on public.student_flags;
create policy staff_all on public.student_flags
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

comment on table public.student_flags is
  'Tutor-raised concerns about a student, surfaced in the Action Centre until resolved.';
comment on column public.student_flags.student_name is
  'Copied at flag time so the Action Centre never needs a join to render.';
comment on column public.student_flags.status is
  'open until a director resolves it — resolving never deletes the row.';
