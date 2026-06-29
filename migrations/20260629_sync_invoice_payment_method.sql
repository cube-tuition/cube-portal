-- Keep an invoice's payment_method in sync with its family's students: a
-- non-voided invoice is 'cash' if ANY student in its scope (same family, or the
-- solo student) is cash, else 'bank'. So changing a student's method on the
-- explorer flows straight through to existing invoices (and the cash-income
-- figure on the accounting dashboard), not just newly generated ones.
create or replace function public.sync_family_invoice_payment_method()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'UPDATE' and NEW.payment_method is not distinct from OLD.payment_method then
    return NEW;
  end if;
  update public.invoices i
  set payment_method = case when exists (
        select 1 from public.students s
        where s.payment_method = 'cash'
          and ( (i.family_id is not null and s.family_id = i.family_id)
                or (i.family_id is null and s.id = i.student_id) )
      ) then 'cash' else 'bank' end
  where i.status <> 'voided'
    and ( (NEW.family_id is not null and i.family_id = NEW.family_id)
          or i.student_id = NEW.id );
  return NEW;
end $$;

drop trigger if exists sync_family_invoice_payment_method on public.students;
create trigger sync_family_invoice_payment_method
  after insert or update of payment_method on public.students
  for each row execute function public.sync_family_invoice_payment_method();

-- One-time backfill: recompute every non-voided invoice from current students.
update public.invoices i
set payment_method = case when exists (
      select 1 from public.students s
      where s.payment_method = 'cash'
        and ( (i.family_id is not null and s.family_id = i.family_id)
              or (i.family_id is null and s.id = i.student_id) )
    ) then 'cash' else 'bank' end
where i.status <> 'voided';
