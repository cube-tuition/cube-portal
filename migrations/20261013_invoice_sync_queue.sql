-- Draft invoices follow enrolment changes (and the old price trigger goes).
--
-- 1. trg_recalculate_invoice_on_enrolment_price is dropped. On every change
--    to an enrolment's price it rewrote total / subtotal / discounts of EVERY
--    invoice for that family and term — approved, in Xero or voided alike —
--    with a formula of its own that disagreed with the real rules: it counted
--    disenrolled classes, ignored credits, referral and cash discounts, gave
--    an only child a $50 "sibling" discount, and never touched line_items, so
--    the stored total (what the PDF and the cash log show) stopped matching
--    the lines (what Xero gets). Invoices 427 and 441 (Term 4) were left that
--    way; the invoices page now flags them for Refresh.
--
-- 2. In its place, every enrolment change queues the (student, class) pair it
--    touched. lib/invoiceSync (run when the invoices page opens, and daily)
--    brings DRAFT invoices in line with the shared billing rules
--    (lib/billing), touching only the lines of the enrolments that changed —
--    never a price or a removal staff made by hand. Approved invoices are
--    never changed automatically; the invoices page flags them instead.

drop trigger if exists trg_recalculate_invoice_on_enrolment_price on public.enrolments;
drop function if exists public.fn_recalculate_invoice_on_enrolment_price();

create table if not exists public.invoice_sync_queue (
  id         bigint generated always as identity primary key,
  student_id uuid not null,
  class_id   integer not null,
  queued_at  timestamptz not null default now()
);
-- No policies: only the service role (the sync) reads or clears it.
alter table public.invoice_sync_queue enable row level security;

create or replace function public.queue_invoice_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE'
     and new.status     is not distinct from old.status
     and new.price      is not distinct from old.price
     and new.class_id   is not distinct from old.class_id
     and new.student_id is not distinct from old.student_id then
    return null;                                  -- nothing billable changed
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.student_id is not null and old.class_id is not null then
    insert into public.invoice_sync_queue (student_id, class_id) values (old.student_id, old.class_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.student_id is not null and new.class_id is not null
     and (tg_op = 'INSERT' or new.student_id is distinct from old.student_id or new.class_id is distinct from old.class_id) then
    insert into public.invoice_sync_queue (student_id, class_id) values (new.student_id, new.class_id);
  end if;
  return null;
end;
$function$;

-- A trigger function can't be called directly; keep it off the API anyway.
revoke all on function public.queue_invoice_sync() from public, anon, authenticated;

drop trigger if exists enrolments_queue_invoice_sync on public.enrolments;
create trigger enrolments_queue_invoice_sync
  after insert or delete or update of status, price, class_id, student_id on public.enrolments
  for each row execute function public.queue_invoice_sync();
