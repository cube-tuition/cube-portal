-- Marking a CASH invoice paid now records the money in the cash log by itself.
-- The row remembers which invoice it came from, which does two jobs: the unique
-- index stops a second row when an invoice is flipped paid → unpaid → paid, and
-- un-marking an invoice can delete exactly the row it created (the same trick
-- cash_pay_status.cash_log_id plays for cash-paid wages).
--
-- Rows entered by hand keep invoice_id null, so nothing existing is affected.
alter table public.cash_log
  add column if not exists invoice_id integer references public.invoices(id) on delete set null;

create unique index if not exists cash_log_invoice_uniq
  on public.cash_log (invoice_id) where invoice_id is not null;

comment on column public.cash_log.invoice_id is
  'The cash invoice whose payment created this row (auto-added by /api/update-invoice-status). Null for hand-entered rows.';
