-- Supabase advisor fixes (2026-09-30), both ERROR level.
--
-- 1. website_timetable was SECURITY DEFINER — it ran with its creator's
--    rights so the public website could read the timetable anonymously.
--    Flip it to security_invoker (definition unchanged) and grant anon
--    read-only SELECT on courses, the one base table its RLS didn't already
--    let anon read (terms and classes have public read policies). The view
--    already published course name/code/price by design, and courses holds
--    nothing else (id, names, price, delivery_mode, active, created_at), so
--    this exposes nothing new — it just moves the exposure into a policy the
--    linter can see.
--
-- 2. _whitney_backup_20260922 (an ad-hoc pre-rename backup: 11 rows of
--    {kind, ref, old_value}) sat in public with RLS off — anonymously
--    readable. RLS on with no client policies denies anon/authenticated;
--    the service role still reads it. Grants revoked as belt and braces.

alter view public.website_timetable set (security_invoker = true);

drop policy if exists courses_public_read on public.courses;
create policy courses_public_read on public.courses
  for select to anon using (true);

alter table public._whitney_backup_20260922 enable row level security;
revoke all on table public._whitney_backup_20260922 from anon, authenticated;
