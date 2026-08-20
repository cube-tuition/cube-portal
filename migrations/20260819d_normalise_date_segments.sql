-- normalise_portal_path collapsed uuids, bare numbers and long slugs, but not
-- dates — so /tutor/classes/599/2026-08-15 stored as
-- /tutor/classes/:id/2026-08-15. That is one row per class per session date per
-- user per day, which is exactly the unbounded growth the table was designed to
-- avoid, and it splits one route across dozens of rows in the monitoring page's
-- Pages tab.
--
-- Adds a date rule, then re-normalises the rows already stored. Re-normalising
-- can map two old rows onto one new one, so it aggregates rather than updating
-- in place (the primary key is (user_id, day, path)).

create or replace function public.normalise_portal_path(p_path text)
returns text
language plpgsql immutable
as $$
declare v text;
begin
  v := split_part(coalesce(p_path, ''), '?', 1);   -- drop any query string
  v := split_part(v, '#', 1);                      -- and any fragment
  if v = '' then return '/'; end if;
  if left(v, 1) <> '/' then v := '/' || v; end if;
  -- uuids first, then ISO dates, then bare numeric segments, then long slugs
  v := regexp_replace(v, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g');
  v := regexp_replace(v, '/[0-9]{4}-[0-9]{2}-[0-9]{2}(?=/|$)', '/:date', 'g');
  v := regexp_replace(v, '/[0-9]+(?=/|$)', '/:id', 'g');
  v := regexp_replace(v, '/[A-Za-z0-9_-]{24,}(?=/|$)', '/:id', 'g');
  v := rtrim(v, '/');
  if v = '' then v := '/'; end if;
  return left(v, 120);
end $$;

-- Fold what is already stored onto the new routes.
create temp table pv_renormalised on commit drop as
select user_id, day, public.normalise_portal_path(path) as path,
       sum(views)::int as views, max(last_seen) as last_seen
from public.portal_page_views
group by 1, 2, 3;

delete from public.portal_page_views;
insert into public.portal_page_views (user_id, day, path, views, last_seen)
select user_id, day, path, views, last_seen from pv_renormalised;
