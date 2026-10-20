-- Trial invitation class picker.
--
-- A trial invitation email (and a level test results email, which carries
-- one) links to /trial/<token>: a short form where the family picks which of
-- the offered classes to trial in. Picking a class books it straight away —
-- the subject's trial enrolment gets the class and the first trial lesson —
-- so the card moves to Trial scheduled and the automatic reminders take over.
-- A 1:1 with flexible times is offered as times staff typed in; a picked time
-- is recorded for staff to set up the 1:1 (no class is created here).
--
--   sections  [{ submission_id, label, options: [{ id, kind: 'class' | 'slot',
--               class_id?, class_name?, day?, start, end, date }] }]
--   picks     { "<submission_id>": { option_id, picked_at } }
--   note      what suits instead, when none of the options do
--
-- Directors only; the family's form reaches it by token through the service
-- role (/api/trial-invite/<token>), like level_test_invites.

create table if not exists public.trial_invites (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique,
  submission_ids integer[] not null default '{}',
  parent_email   text,
  parent_name    text,
  student_name   text,
  sections       jsonb not null default '[]',
  picks          jsonb not null default '{}',
  note           text,
  source         text not null default 'invitation' check (source in ('invitation', 'level_test')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz
);
create index if not exists trial_invites_submission_ids on public.trial_invites using gin (submission_ids);
alter table public.trial_invites enable row level security;
drop policy if exists trial_invites_admin on public.trial_invites;
create policy trial_invites_admin on public.trial_invites for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

insert into public.test_snapshot_objects (kind, name, ord)
select 'table', 'trial_invites', coalesce((select max(ord) from public.test_snapshot_objects where kind = 'table'), 0) + 1
 where not exists (select 1 from public.test_snapshot_objects where kind = 'table' and name = 'trial_invites');
