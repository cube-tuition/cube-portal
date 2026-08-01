-- Booklet improvement checklists.
--
-- Tutors report booklet problems from the lesson page. Each report becomes ONE
-- tickable entry on one of two checklists held on the booklet:
--   booklets.fixes       — errors to correct (typos, wrong answers)
--   booklets.suggestions — ideas for improving the booklet
-- Both are separate from booklets.notes, which stays a free-text staff note.
--
-- Item shape (jsonb array element):
--   { id, text, done, done_at, done_by,
--     source: 'lesson' | 'staff', lesson_id, class_name, date, author, created_at }
--
-- A lesson owns at most ONE item per list: re-saving that lesson rewrites its
-- item in place. Ticked items stay on the list (struck through in the UI) so the
-- history of what was raised and dealt with is never lost.
--
-- The mutations go through functions rather than a client-side read-modify-write
-- because several classes can use the same booklet on the same evening, and a
-- lost update would silently drop a tutor's report. Each function does the array
-- edit inside a single UPDATE. They are invoker-rights (no SECURITY DEFINER), so
-- the existing RLS policies on booklets still apply.

alter table public.booklets
  add column if not exists fixes       jsonb not null default '[]'::jsonb,
  add column if not exists suggestions jsonb not null default '[]'::jsonb;

comment on column public.booklets.fixes is
  'Checklist of errors to fix, one entry per lesson report or staff addition.';
comment on column public.booklets.suggestions is
  'Checklist of improvement suggestions, one entry per lesson report or staff addition.';

-- notes_wb_sync stored the exact text last written into booklets.notes so it
-- could be swapped out. Checklist items are found by lesson_id instead, so the
-- column is no longer needed.
alter table public.lessons drop column if exists notes_wb_sync;

-- Guard against a bad list name reaching format() below.
create or replace function public._booklet_list_col(p_list text)
returns text language sql immutable as $$
  select case p_list when 'fixes' then 'fixes' when 'suggestions' then 'suggestions' end
$$;

-- Upsert a lesson's entry on a list. p_item null removes that lesson's entry
-- (the tutor cleared the box). The entry is replaced where it already sits and
-- appended only on a lesson's first report, so re-saving never duplicates or
-- reorders. The item id is carried over, and the tick is preserved when the text
-- is unchanged -- a re-save for unrelated reasons must not reopen a closed item,
-- while genuinely new wording does reopen it.
create or replace function public.booklet_checklist_upsert(
  p_booklet_id uuid,
  p_list       text,
  p_lesson_id  integer,
  p_item       jsonb
) returns jsonb
language plpgsql as $$
declare
  col text := public._booklet_list_col(p_list);
  out jsonb;
begin
  if col is null then raise exception 'unknown list %', p_list; end if;
  if p_lesson_id is null then raise exception 'lesson id required'; end if;

  execute format($f$
    update public.booklets
       set %1$I = (
             select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
               from (
                 select case
                          when e->>'lesson_id' = $2::text then
                            $3 || jsonb_build_object('id', e->>'id')
                               || case when e->>'text' = $3->>'text'
                                       then jsonb_build_object('done',    e->'done',
                                                               'done_at', e->'done_at',
                                                               'done_by', e->'done_by')
                                       else '{}'::jsonb end
                          else e
                        end as e,
                        ord::numeric as ord
                   from jsonb_array_elements(%1$I) with ordinality t(e, ord)
                  where not (e->>'lesson_id' = $2::text and $3 is null)
                 union all
                 select $3, 1e9
                  where $3 is not null
                    and not exists (
                      select 1 from jsonb_array_elements(%1$I) x
                       where x->>'lesson_id' = $2::text)
               ) s
           )
     where id = $1
     returning %1$I
  $f$, col)
  into out using p_booklet_id, p_lesson_id, p_item;

  return out;
end $$;

-- Add a staff-authored entry (not tied to any lesson).
create or replace function public.booklet_checklist_add(
  p_booklet_id uuid,
  p_list       text,
  p_item       jsonb
) returns jsonb
language plpgsql as $$
declare
  col text := public._booklet_list_col(p_list);
  out jsonb;
begin
  if col is null then raise exception 'unknown list %', p_list; end if;
  execute format('update public.booklets set %1$I = coalesce(%1$I, ''[]''::jsonb) || jsonb_build_array($2) where id = $1 returning %1$I', col)
    into out using p_booklet_id, p_item;
  return out;
end $$;

-- Tick / untick one item.
create or replace function public.booklet_checklist_set_done(
  p_booklet_id uuid,
  p_list       text,
  p_item_id    text,
  p_done       boolean,
  p_by         text
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
             select coalesce(jsonb_agg(
                      case when e->>'id' = $2
                        then e || jsonb_build_object('done', $3,
                               'done_at', case when $3 then now()::text else null end,
                               'done_by', case when $3 then $4 else null end)
                        else e end order by ord), '[]'::jsonb)
               from jsonb_array_elements(%1$I) with ordinality t(e, ord)
           )
     where id = $1
     returning %1$I
  $f$, col)
  into out using p_booklet_id, p_item_id, p_done, p_by;
  return out;
end $$;

-- Remove a staff-authored entry. Lesson-sourced entries are left alone so a
-- tutor's report cannot be deleted out from under them.
create or replace function public.booklet_checklist_remove_staff_item(
  p_booklet_id uuid,
  p_list       text,
  p_item_id    text
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
              where not (e->>'id' = $2 and e->>'source' = 'staff')
           )
     where id = $1
     returning %1$I
  $f$, col)
  into out using p_booklet_id, p_item_id;
  return out;
end $$;
