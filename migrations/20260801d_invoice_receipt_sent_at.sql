-- When a payment receipt was last emailed to the family for this invoice.
-- Receipts are only offered once payment_status = 'paid'; the timestamp lets
-- the invoices list show "Receipt sent" so nobody double-sends.
alter table public.invoices
  add column if not exists receipt_sent_at timestamptz;

comment on column public.invoices.receipt_sent_at is
  'Last time a payment receipt email was sent for this invoice.';
