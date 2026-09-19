-- Holiday periods are now term rows themselves (term_number > 10, e.g. "Term
-- 2–3 Holidays 2026"), so pay_period_for started treating a break as a
-- teaching term: it chopped the holidays into W1-2 / W3-4 fortnights, one of
-- which ran past the next term's start, and the Holidays period (index 0)
-- was never reached. The payroll Holidays tab therefore opened a stray
-- fortnight run, and the real holiday run stopped matching its shifts.
--
-- Pay periods follow TEACHING terms only. A date inside a break resolves to
-- the Holidays period after the preceding teaching term, ending the day
-- before the next teaching term starts.
create or replace function public.pay_period_for(p_date date)
 returns table(period_start date, period_end date, fortnight_index integer, term_id uuid)
 language plpgsql
 stable
as $function$
declare
  v_term       public.terms%rowtype;
  v_next_start date;
  v_diff       int;
  v_idx        int;
begin
  -- 1. Inside a teaching term → that term's fortnight (W1-2 … W9-10).
  select * into v_term from public.terms
   where p_date between start_date and end_date
     and coalesce(term_number, 0) <= 10
   order by start_date desc limit 1;
  if found then
    v_diff := p_date - v_term.start_date;
    v_idx  := least(5, greatest(1, (v_diff / 14)::int + 1));
    period_start    := v_term.start_date + (v_idx - 1) * 14;
    period_end      := period_start + 13;
    fortnight_index := v_idx;
    term_id         := v_term.id;
    return next; return;
  end if;

  -- 2. After a teaching term (holiday break, or after the final term) → a
  --    Holidays period spanning to the day before the next teaching term.
  select * into v_term from public.terms
   where end_date < p_date and coalesce(term_number, 0) <= 10
   order by end_date desc limit 1;
  if found then
    select min(start_date) into v_next_start from public.terms
     where start_date > v_term.end_date and coalesce(term_number, 0) <= 10;
    period_start    := v_term.end_date + 1;
    period_end      := coalesce(v_next_start - 1, v_term.end_date + 42);
    fortnight_index := 0;            -- 0 = Holidays
    term_id         := v_term.id;    -- the holiday that follows this term
    return next; return;
  end if;

  -- 3. Before any teaching term exists → earliest one, fortnight 1.
  select * into v_term from public.terms
   where coalesce(term_number, 0) <= 10 order by start_date asc limit 1;
  if not found then return; end if;
  period_start    := v_term.start_date;
  period_end      := period_start + 13;
  fortnight_index := 1;
  term_id         := v_term.id;
  return next;
end;
$function$;
