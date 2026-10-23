-- A record of every bulk email the portal sends (course offers, holiday
-- courses, the discount program, review requests, term-start emails): one row
-- per family per campaign, grouped by campaign_id. Shown on /tutor/emails/sent.
--
-- Until now the only record was a BCC copy of every message to the office
-- inbox, which meant 34 identical emails for a 34-family campaign. The bulk
-- routes now write here and send the office ONE summary per campaign;
-- one-to-one emails (absence notes, invitations, reports) keep their BCC.
create table if not exists public.sent_emails (
  id          bigserial primary key,
  sent_at     timestamptz not null default now(),
  campaign_id uuid not null,
  campaign    text not null,
  subject     text not null,
  to_email    text,
  to_name     text,
  status      text not null check (status in ('sent', 'failed')),
  error       text,
  resend_id   text,
  is_test     boolean not null default false,
  sent_by     uuid,
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists sent_emails_campaign_idx on public.sent_emails(campaign_id);
create index if not exists sent_emails_sent_at_idx on public.sent_emails(sent_at desc);
create index if not exists sent_emails_to_idx on public.sent_emails(lower(to_email));

alter table public.sent_emails enable row level security;
-- Family email addresses: directors read; only the server (service role) writes.
drop policy if exists sent_emails_directors_read on public.sent_emails;
create policy sent_emails_directors_read on public.sent_emails for select to authenticated
  using (public.is_admin(auth.uid()));

insert into public.test_snapshot_objects (kind, name, ord)
select 'table', 'sent_emails', (select max(ord) from public.test_snapshot_objects where kind = 'table') + 1
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = 'table' and o.name = 'sent_emails');
