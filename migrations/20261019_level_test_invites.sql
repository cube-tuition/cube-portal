-- Level test invitations: a trial enquiry can be invited to sit a level test
-- first, before a class is chosen.
--
-- Staff compose the email in the trial pipeline with a few suggested times.
-- The email links to /level-test/<token>, a form (no login — the token is the
-- key, checked by /api/level-test-invite) where the parent picks one; picking
-- books the level test (a lessons row, lesson_type 'level_test') so it shows
-- on Monitoring → Level tests. "None of these suit" records the times they
-- give instead, for staff to follow up.
--
-- One invite per enquiry: a resend updates the times and keeps the link, so an
-- older email still opens the current choices. Directors only — the public
-- form reaches it through the service role, by token.

create table if not exists public.level_test_invites (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  submission_id integer not null unique references public.trial_submissions(id) on delete cascade,
  student_id    uuid references public.students(id) on delete set null,
  student_name  text,
  build_ids     uuid[] not null default '{}',
  -- [{ date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' | null, room: text | null }]
  slots         jsonb not null default '[]'::jsonb,
  lesson_id     integer references public.lessons(id) on delete set null,
  chosen_slot   jsonb,
  parent_note   text,
  sent_at       timestamptz,
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.level_test_invites enable row level security;
create policy admin_all on public.level_test_invites for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- The card's "Level test invited" badge — dated from the first send, like
-- invitation_sent_at — and sending it counts as acting on the case.
alter table public.trial_submissions
  add column if not exists level_test_invitation_sent_at timestamptz;

create or replace function public.trial_submission_activity()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    new.last_activity_at := coalesce(new.last_activity_at, new.submitted_at, now());
    return new;
  end if;
  if new.status               is distinct from old.status
     or new.admin_notes        is distinct from old.admin_notes
     or new.notes              is distinct from old.notes
     or new.trial_date         is distinct from old.trial_date
     or new.trial_class_id     is distinct from old.trial_class_id
     or new.converted_student_id is distinct from old.converted_student_id
     or new.enrolment_id       is distinct from old.enrolment_id
     or new.contacted_at       is distinct from old.contacted_at
     or new.invitation_sent_at is distinct from old.invitation_sent_at
     or new.level_test_invitation_sent_at is distinct from old.level_test_invitation_sent_at
     or new.reminder_sent_at   is distinct from old.reminder_sent_at
     or new.lesson1_feedback_sent_at is distinct from old.lesson1_feedback_sent_at
     or new.outcome_sent_at    is distinct from old.outcome_sent_at then
    new.last_activity_at := now();
    new.stale_notified_at := null;
  end if;
  return new;
end;
$function$;

insert into public.test_snapshot_objects (kind, name, ord)
select 'table', 'level_test_invites', coalesce((select max(ord) from public.test_snapshot_objects where kind = 'table'), 0) + 1
 where not exists (select 1 from public.test_snapshot_objects where kind = 'table' and name = 'level_test_invites');
