-- generate_lessons_for_class is a SECURITY DEFINER function that bulk-inserts
-- lessons with no internal authorisation check, callable over PostgREST by
-- anon and by any authenticated user — and `authenticated` includes students.
--
-- Verified orphaned before revoking: no trigger fires it, no other function
-- body references it, and no application code calls it (the portal uses
-- sync_lessons_for_class instead). Withdrawing execute is therefore complete
-- and carries none of the risk of rewriting the body to add a guard.
-- postgres/service_role retain access for admin or server-side use.
--
-- NOTE (not fixed here — needs review): sync_lessons_for_class(integer) has the
-- same shape — SECURITY DEFINER, no internal auth check, executable by anon and
-- authenticated — and it DELETEs as well as inserts. It cannot simply have its
-- grants revoked because app/tutor/database/page.js calls it as an ordinary
-- authenticated user, so revoking `authenticated` would break that page while
-- keeping it leaves the function reachable by students. The correct fix is an
-- internal `if not public.is_staff() then raise exception` guard, which means
-- rewriting the body — deliberately left for review rather than done unattended.

revoke execute on function public.generate_lessons_for_class(integer) from public, anon, authenticated;
