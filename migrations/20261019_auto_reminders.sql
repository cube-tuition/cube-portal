-- Automatic reminders, 24 hours before a booked level test and before each
-- trial lesson (lib/autoReminders, /api/reminders/upcoming).
--
-- auto_reminders is the send log: one row per reminder, keyed so it can only
-- be sent once — "trial:<enrolment id>:<lesson date>" or
-- "level_test:<lesson id>:<date>:<start>" (a moved level test is a new
-- reminder). The route claims a key by inserting it before sending.
-- Directors read it; only the service role writes.

create table if not exists public.auto_reminders (
  key           text primary key,
  kind          text not null check (kind in ('trial', 'level_test')),
  submission_id integer references public.trial_submissions(id) on delete set null,
  to_email      text,
  starts_at     timestamptz,
  sent_at       timestamptz not null default now()
);
alter table public.auto_reminders enable row level security;
drop policy if exists auto_reminders_admin_read on public.auto_reminders;
create policy auto_reminders_admin_read on public.auto_reminders for select using (public.is_admin(auth.uid()));

-- Every 15 minutes (pg_cron + the http extension, as chat-scheduled-delivery).
select cron.unschedule('upcoming-reminders') where exists (select 1 from cron.job where jobname = 'upcoming-reminders');
select cron.schedule('upcoming-reminders', '*/15 * * * *',
  $$ select (extensions.http_get('https://portal.cubetuition.com.au/api/reminders/upcoming')).status $$);

-- The access test (tests/access.db.test.mjs) builds this table from the snapshot.
insert into public.test_snapshot_objects (kind, name, ord)
select 'table', 'auto_reminders', coalesce((select max(ord) from public.test_snapshot_objects where kind = 'table'), 0) + 1
 where not exists (select 1 from public.test_snapshot_objects where kind = 'table' and name = 'auto_reminders');
