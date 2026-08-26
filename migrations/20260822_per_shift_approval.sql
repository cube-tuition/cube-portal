-- Shifts can be approved individually, and a pay run can be finalised with
-- only the shifts that were approved.
--
-- approve_pay_run was all-or-nothing: one sweep attached and approved every
-- eligible shift in the fortnight. There was no way to hold one questionable
-- shift back while paying the rest. Now:
--
--   approve_shift(shift, run)   approve ONE shift into the run
--   unapprove_shift(shift)      undo one (until the run is exported/paid)
--   approve_pay_run(run, sweep) sweep := false finalises the run with only
--                               the already-approved shifts; the rest stay
--                               submitted/draft and unattached
--
-- Period membership is checked through the pay_run_shifts VIEW, not raw
-- work_date — the view assigns term-break shifts to their clamped fortnight
-- (pay_period_for), and the page lists what the view says, so approval must
-- agree with what the admin can see. Guards mirror approve_pay_run exactly.

-- Totals kept live as shifts attach/detach, so the run header never lies.
create or replace function public.pay_run_recompute_totals(p_pay_run uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;
  update public.pay_runs pr
     set total_hours  = coalesce(t.h, 0),
         total_amount = coalesce(t.a, 0)
    from (select coalesce(sum(hours),0)::numeric(10,2) as h,
                 coalesce(sum(hours * coalesce(rate_snapshot,0)),0)::numeric(12,2) as a
            from public.shifts where pay_run_id = p_pay_run) t
   where pr.id = p_pay_run;
end $$;

create or replace function public.approve_shift(p_shift uuid, p_pay_run uuid)
returns public.shifts
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pr public.pay_runs%rowtype;
  v_s  public.shifts%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status in ('exported','paid') then
    raise exception 'pay run already %', v_pr.status;
  end if;

  select * into v_s from public.shifts where id = p_shift for update;
  if not found then raise exception 'shift not found'; end if;
  if v_s.status = 'approved' then raise exception 'shift already approved'; end if;
  if v_s.status = 'paid' then raise exception 'shift already paid'; end if;
  if v_s.rate_snapshot is null then
    raise exception 'shift has no rate — set a rate before approving';
  end if;
  if not exists (
    select 1 from public.pay_run_shifts v
     where v.id = p_shift
       and v.period_start = v_pr.period_start
       and v.period_end   = v_pr.period_end
  ) then
    raise exception 'shift is not in this pay period';
  end if;

  update public.shifts
     set status = 'approved', pay_run_id = v_pr.id,
         approved_at = now(), approved_by = auth.uid()
   where id = p_shift
  returning * into v_s;

  perform public.pay_run_recompute_totals(v_pr.id);
  return v_s;
end $$;

create or replace function public.unapprove_shift(p_shift uuid)
returns public.shifts
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_s   public.shifts%rowtype;
  v_run uuid;
  v_status text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_s from public.shifts where id = p_shift for update;
  if not found then raise exception 'shift not found'; end if;
  if v_s.status <> 'approved' then
    raise exception 'shift is % — only approved shifts can be unapproved', v_s.status;
  end if;

  v_run := v_s.pay_run_id;
  if v_run is not null then
    select status into v_status from public.pay_runs where id = v_run;
    if v_status in ('exported','paid') then
      raise exception 'pay run already % — the shift cannot be pulled back', v_status;
    end if;
  end if;

  update public.shifts
     set status = 'submitted', pay_run_id = null,
         approved_at = null, approved_by = null
   where id = p_shift
  returning * into v_s;

  if v_run is not null then
    perform public.pay_run_recompute_totals(v_run);
  end if;
  return v_s;
end $$;

-- Same function, one new switch. DROP first: CREATE OR REPLACE with an added
-- argument would leave the one-arg version behind as an overload, and PostgREST
-- would then refuse the call as ambiguous.
drop function if exists public.approve_pay_run(uuid);

create function public.approve_pay_run(p_pay_run uuid, p_sweep boolean default true)
returns public.pay_runs
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pr public.pay_runs%rowtype;
  v_hours numeric(10,2);
  v_amount numeric(12,2);
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status in ('exported','paid') then
    raise exception 'pay run already %', v_pr.status;
  end if;

  if p_sweep then
    -- Attach + approve every eligible shift in the period (original behaviour)
    update public.shifts s
       set status      = 'approved',
           pay_run_id  = v_pr.id,
           approved_at = now(),
           approved_by = auth.uid()
     where s.work_date between v_pr.period_start and v_pr.period_end
       and s.status in ('draft','submitted')
       and s.rate_snapshot is not null;     -- skip unpriced shifts
  elsif not exists (select 1 from public.shifts where pay_run_id = v_pr.id) then
    raise exception 'no approved shifts attached — approve at least one shift first';
  end if;

  select coalesce(sum(hours),0)::numeric(10,2),
         coalesce(sum(hours * coalesce(rate_snapshot,0)),0)::numeric(12,2)
    into v_hours, v_amount
    from public.shifts
   where pay_run_id = v_pr.id;

  update public.pay_runs
     set status       = 'approved',
         approved_at  = now(),
         approved_by  = auth.uid(),
         total_hours  = v_hours,
         total_amount = v_amount
   where id = v_pr.id
  returning * into v_pr;

  return v_pr;
end $$;
