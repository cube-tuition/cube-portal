-- Mark an invoice paid in Xero when it is marked paid in the portal.
--
-- Xero has no "set this invoice to paid" flag: an invoice is PAID when the
-- payments applied to it cover its total. So marking paid means creating a
-- Payment against the invoice, and un-marking means deleting that payment
-- again. xero_payment_id remembers which payment we created so un-marking can
-- reverse exactly the right one rather than guessing from the amount — a
-- family that pays in two instalments would otherwise be ambiguous.
--
-- Every payment needs a bank account to land in, which the invoice line
-- accounts can't supply (they are revenue accounts). payment_account_code
-- holds the Xero BANK account code; without it the sync reports that payments
-- are not configured rather than guessing an account.

alter table public.invoices
  add column if not exists xero_payment_id text;

alter table public.xero_settings
  add column if not exists payment_account_code text;

-- Finding the invoice behind a Xero payment id, for reconciliation.
create index if not exists invoices_xero_payment_id_idx
  on public.invoices (xero_payment_id)
  where xero_payment_id is not null;
