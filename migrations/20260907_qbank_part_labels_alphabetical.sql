-- Part labels are the part's position, always alphabetical.
--
-- The label used to be typed by hand in the question editor and stored per part,
-- so it went stale the moment a part was inserted or removed: deleting (a) left
-- the rest reading (b), (c). Every reader also derived a fallback inline from
-- 'abcdefgh', which ran out at the 9th part and printed "9".
--
-- The app now derives the label from order everywhere (lib/qbank.js partLabel),
-- and the editor shows it read-only. This realigns the rows already stored so
-- the database says the same thing the page does.
with ordered as (
  select p.id,
         (row_number() over (partition by p.question_id order by p.sort_order, p.id) - 1)::int as idx
    from public.qbank_question_parts p
)
update public.qbank_question_parts p
   set part_label = substr('abcdefghijklmnopqrstuvwxyz'::text, o.idx + 1, 1)
  from ordered o
 where o.id = p.id
   and o.idx < 26
   and p.part_label is distinct from substr('abcdefghijklmnopqrstuvwxyz'::text, o.idx + 1, 1);
