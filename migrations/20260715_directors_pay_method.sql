-- Directors are paid through payroll like tutors (shifts, rates matrix), but had
-- no pay_method — the payroll UI hardcoded them to bank. Give directors the same
-- pay columns as tutors so their pay method (bank/cash) and cash pay day are
-- real, editable settings.

alter table public.directors add column if not exists pay_method text default 'bank';
alter table public.directors add column if not exists cash_pay_weekday smallint;
