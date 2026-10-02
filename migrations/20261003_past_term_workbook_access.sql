-- Past terms: students keep access to the online workbooks of classes they
-- were in. Same rule as lib/classAccess.js:
--   * an active, un-ended enrolment opens every week of the class;
--   * an ended enrolment (left / moved part-way) opens the weeks up to and
--     including the week of the class's term in which it ended — ended before
--     the term began: nothing; ended after it finished: the whole term.
-- The workbook must be set for an open week.

create or replace function public.student_class_open_week(p_class integer)
returns integer      -- null = every week, 0 = no access, n = weeks 1..n
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_end date; v_start date; v_finish date;
begin
  if exists (select 1 from enrolments e
             where e.class_id = p_class and e.student_id = auth.uid()
               and e.status = 'active' and e.ended_at is null) then
    return null;
  end if;
  select max(e.ended_at::date) into v_end from enrolments e
   where e.class_id = p_class and e.student_id = auth.uid() and e.ended_at is not null;
  if v_end is null then return 0; end if;
  select t.start_date, t.end_date into v_start, v_finish
    from classes c join terms t on t.id = c.term_id where c.id = p_class;
  if v_start is null then return null; end if;
  if v_end < v_start then return 0; end if;
  if v_end > v_finish then return null; end if;
  return floor((v_end - v_start) / 7) + 1;
end $$;

create or replace function public.student_workbook_blocks(p_booklet uuid, p_class integer)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare raw jsonb; v_open integer;
begin
  v_open := student_class_open_week(p_class);
  if v_open = 0 then
    raise exception 'not enrolled in this class';
  end if;

  if not exists (
    select 1 from class_booklet_assignments a
    where a.class_id = p_class and a.booklet_id = p_booklet
      and (v_open is null or a.week between 1 and v_open)
  ) then
    raise exception 'this workbook is not assigned to that class';
  end if;

  select bb.blocks into raw
  from booklet_builds bb
  join booklets b on b.id = bb.booklet_id
  where bb.booklet_id = p_booklet and b.delivery = 'online'
  limit 1;

  if raw is null then
    return null;
  end if;

  -- Strip solutions from the block and from each of its parts.
  return (
    select coalesce(jsonb_agg(
      (blk - 'solution' - 'solutionImage' - 'solutionMathObj' - 'explanation' - 'answer')
      || case when blk ? 'parts' then jsonb_build_object('parts', coalesce((
             select jsonb_agg(p - 'solution' - 'solutionImage' - 'solutionMathObj' - 'answer'
                              order by ord)
             from jsonb_array_elements(blk->'parts') with ordinality t(p, ord)
           ), '[]'::jsonb))
         else '{}'::jsonb end
      order by ord
    ), '[]'::jsonb)
    from jsonb_array_elements(raw) with ordinality b(blk, ord)
  );
end $function$;

-- A class's shared workbook notes stay readable to anyone who was in the class.
drop policy if exists class_read on public.workbook_class_notes;
create policy class_read on public.workbook_class_notes for select using (
  exists (select 1 from enrolments e
          where e.class_id = workbook_class_notes.class_id and e.student_id = auth.uid())
);
