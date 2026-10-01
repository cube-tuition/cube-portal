-- System accounts (e.g. the "App Review" login Apple's reviewers use) can sign
-- in and see their own tutors row, but nobody else ever sees them: not in
-- teacher dropdowns, staff chat, payroll, availability or the database
-- explorer. Applied to production on 2026-10-01 via the Supabase MCP.
alter table public.tutors add column if not exists system boolean not null default false;
comment on column public.tutors.system is 'A login that exists for testing/review only; hidden from every other user by RLS.';

drop policy if exists authenticated_full_access on public.tutors;
create policy authenticated_full_access on public.tutors
  for all to authenticated
  using (is_staff() and (not system or id = auth.uid()))
  with check (is_staff() and (not system or id = auth.uid()));

-- Staff chat's membership checks run as definer (bypassing RLS), so they must
-- skip system accounts explicitly.
create or replace function public.chat_staff_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id from public.tutors where coalesce(active, true) and not system
  union select id from public.directors
$function$;
