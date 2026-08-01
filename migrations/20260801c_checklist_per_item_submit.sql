-- Per-item submits on the lesson page.
--
-- Tutors now send ONE fix or suggestion at a time rather than one box-worth per
-- lesson, so a lesson can own several entries on a list. Appending is already
-- what booklet_checklist_add does (the item simply carries lesson_id), which
-- makes the replace-in-place upsert redundant.
drop function if exists public.booklet_checklist_upsert(uuid, text, integer, jsonb);

-- These held the last text typed into each box. With per-item submits the box
-- clears on send, and the checklist entries (tagged with lesson_id) are the
-- record, so nothing reads them. Both were empty when dropped.
alter table public.lessons
  drop column if exists notes_wb_errors,
  drop column if exists notes_wb_suggestions;

-- One delete covering both callers:
--   p_lesson_id null     → staff removing a staff-authored item (booklet screen)
--   p_lesson_id supplied → a tutor withdrawing an item THEY submitted from that
--                          lesson, and only while it is still open. A ticked item
--                          is locked: somebody has already acted on it.
--
-- NOTE the coalesce(..., false) around the whole match. A staff item has
-- lesson_id null, so `e->>'lesson_id' = $3::text` evaluates to NULL rather than
-- false; `not NULL` is NULL, the row then fails the WHERE and the item is
-- deleted. Without the coalesce any tutor could delete staff items.
create or replace function public.booklet_checklist_remove_item(
  p_booklet_id uuid,
  p_list       text,
  p_item_id    text,
  p_lesson_id  integer default null
) returns jsonb
language plpgsql as $$
declare
  col text := public._booklet_list_col(p_list);
  out jsonb;
begin
  if col is null then raise exception 'unknown list %', p_list; end if;
  execute format($f$
    update public.booklets
       set %1$I = (
             select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
               from jsonb_array_elements(%1$I) with ordinality t(e, ord)
              where not coalesce(
                e->>'id' = $2
                and (
                  ($3 is null     and e->>'source' = 'staff')
                  or
                  ($3 is not null and e->>'lesson_id' = $3::text
                                  and coalesce((e->>'done')::boolean, false) = false)
                ), false)
           )
     where id = $1
     returning %1$I
  $f$, col)
  into out using p_booklet_id, p_item_id, p_lesson_id;
  return out;
end $$;

drop function if exists public.booklet_checklist_remove_staff_item(uuid, text, text);
