-- Payment date for invoices: set when an invoice is marked paid (admin picks
-- the actual date cash/transfer was received; defaults to today in the UI),
-- cleared when payment status moves back off paid.
alter table public.invoices add column if not exists paid_date date;
