-- Defence in depth: remove client-role access that nothing legitimately uses.
--
-- 1. xero_tokens / xero_settings / xero_item_mappings
--    These hold the Xero OAuth refresh tokens and financial mappings. They have
--    RLS enabled with ZERO policies, so PostgREST currently denies anon and
--    authenticated — but only because no policy exists. The underlying table
--    GRANTs are still wide open (Supabase default), so the day someone adds a
--    single permissive policy, or toggles RLS off, these tables are exposed.
--    Revoking the grants means two independent controls must fail, not one.
--
--    Verified safe: the only reader is lib/xero.js, which runs server-side with
--    the service-role key. service_role keeps its grants and is unaffected.
--
-- 2. get_table_oids() / get_column_type(text,text)
--    Schema-introspection helpers with no internal authorisation check,
--    executable by anon via /rest/v1/rpc/*. They leak the shape of the database
--    to unauthenticated callers.
--
--    Verified safe: the only callers are app/tutor/database/page.js (the staff
--    DB explorer), which runs as an authenticated staff user. We revoke `anon`
--    ONLY and deliberately leave `authenticated` intact so that page keeps
--    working.

revoke all on public.xero_tokens        from anon, authenticated;
revoke all on public.xero_settings      from anon, authenticated;
revoke all on public.xero_item_mappings from anon, authenticated;

--    NOTE: get_column_type still carried Postgres' default PUBLIC EXECUTE
--    grant (the `=X/postgres` entry in its ACL). anon inherits EXECUTE through
--    PUBLIC, so revoking `anon` by name alone does nothing — the revoke has to
--    name PUBLIC. get_table_oids had no PUBLIC entry, so `from anon` sufficed.
--    authenticated/service_role hold explicit grants and are unaffected.

revoke execute on function public.get_table_oids()            from anon;
revoke execute on function public.get_column_type(text, text) from public, anon;
grant  execute on function public.get_column_type(text, text) to authenticated, service_role;
