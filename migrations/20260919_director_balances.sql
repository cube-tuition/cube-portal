-- Directors are payable staff but live in `directors`, not `tutors`, so this
-- foreign key made every Mark paid for a director fail. The id is checked by
-- the app against tutors ∪ directors.
alter table public.cash_pay_status drop constraint if exists cash_pay_status_tutor_id_fkey;

-- What a director owes the business, and how it is paid down. A 'debt' row
-- raises the balance; an 'offset' (pay settled against the balance instead of
-- cash) or a 'repayment' (cash handed back) lowers it. An offset links the
-- cash-log pair and the pay-status row it wrote, so undoing it is exact.
create table if not exists public.director_balances (
  id                  uuid primary key default gen_random_uuid(),
  staff_id            uuid not null,
  staff_name          text not null,
  date                date not null default current_date,
  kind                text not null check (kind in ('debt','offset','repayment')),
  amount              numeric(10,2) not null check (amount > 0),
  description         text not null default '',
  pay_run_id          uuid references public.pay_runs(id) on delete set null,
  cash_log_out_id     integer references public.cash_log(id) on delete set null,
  cash_log_in_id      integer references public.cash_log(id) on delete set null,
  cash_pay_status_id  uuid references public.cash_pay_status(id) on delete set null,
  created_by          text,
  created_at          timestamptz not null default now()
);
create index if not exists director_balances_staff_idx on public.director_balances(staff_id, date);
alter table public.director_balances enable row level security;
drop policy if exists staff_all on public.director_balances;
create policy staff_all on public.director_balances for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Opening balances (personal expenses), as confirmed on 2026-09-19.
insert into public.director_balances (staff_id, staff_name, date, kind, amount, description, created_by)
select d.id, d.full_name, '2026-09-19', 'debt', v.amount, 'Personal expenses (opening balance)', 'Claude'
from (values ('Aiden Kim', 1828.00), ('Ryan Park', 2542.50)) as v(name, amount)
join public.directors d on d.full_name = v.name
where not exists (select 1 from public.director_balances b where b.staff_id = d.id);
