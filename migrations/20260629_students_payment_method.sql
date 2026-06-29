-- Per-student payment method (cash | bank), set once and carried across terms.
-- Invoice generation reads it: a family invoice is 'cash' if ANY family member is
-- cash, else 'bank' (the invoice keeps its own payment_method for overrides).
alter table public.students add column if not exists payment_method text not null default 'bank';
alter table public.students drop constraint if exists students_payment_method_check;
alter table public.students add constraint students_payment_method_check check (payment_method in ('cash','bank'));

-- Carry over the existing cash designation from current cash invoices.
update public.students s set payment_method = 'cash'
where exists (
  select 1 from public.invoices i
  where i.payment_method = 'cash' and i.status <> 'voided'
    and (i.student_id = s.id or (i.family_id is not null and i.family_id = s.family_id))
);
