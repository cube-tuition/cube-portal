-- Subpages for Info Centre pages, one level deep (a page may have subpages; a
-- subpage may not). Applied via MCP as: infohub_subpages.
--
-- The depth limit and the audience rule live in a trigger rather than only in
-- the editor: a subpage of a Director page must not be readable by teachers,
-- and that guarantee should not depend on the UI remembering to apply it.
alter table public.infohub_pages
  add column if not exists parent_id uuid references public.infohub_pages(id) on delete set null;
create index if not exists infohub_pages_parent_idx on public.infohub_pages(parent_id);

-- before insert/update of parent_id or visible_roles:
--   * refuses a page as its own parent
--   * refuses a second level (parent is itself a subpage)
--   * refuses demoting a page that already has subpages
--   * copies the parent's visible_roles onto the subpage
create or replace function public.infohub_pages_hierarchy() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_parent_parent uuid; v_parent_roles text[]; v_child_count integer;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A page cannot be its own parent'; end if;
    select parent_id, visible_roles into v_parent_parent, v_parent_roles
      from infohub_pages where id = new.parent_id;
    if v_parent_parent is not null then
      raise exception 'Subpages go one level deep — % is already a subpage', new.parent_id;
    end if;
    select count(*) into v_child_count from infohub_pages where parent_id = new.id;
    if v_child_count > 0 then
      raise exception 'This page has % subpage(s), so it cannot become one itself', v_child_count;
    end if;
    new.visible_roles := v_parent_roles;
  end if;
  return new;
end $$;

drop trigger if exists infohub_pages_hierarchy_trg on public.infohub_pages;
create trigger infohub_pages_hierarchy_trg
  before insert or update of parent_id, visible_roles on public.infohub_pages
  for each row execute function public.infohub_pages_hierarchy();

-- re-tagging a parent carries its subpages with it, so the two cannot drift
create or replace function public.infohub_pages_cascade_roles() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if new.parent_id is null and new.visible_roles is distinct from old.visible_roles then
    update infohub_pages set visible_roles = new.visible_roles
      where parent_id = new.id and visible_roles is distinct from new.visible_roles;
  end if;
  return null;
end $$;

drop trigger if exists infohub_pages_cascade_roles_trg on public.infohub_pages;
create trigger infohub_pages_cascade_roles_trg
  after update of visible_roles on public.infohub_pages
  for each row execute function public.infohub_pages_cascade_roles();
