-- An enrolment without a price takes its class's course price.
--
-- Trial enrolments were created with no price — by the public trial form,
-- and by the Trials page when a trial class is picked — and converting the
-- trial to enrolled only flipped the status. The term transition then copied
-- the blank price into the next term (Max Morrison's Y7 English 1:1 showed no
-- price though the course is $800). Invoices quietly fell back to the course
-- price, but the enrolment showed blank, the forecast counted $0 and absence
-- credits (price ÷ 10) came out at $0.
--
-- Fires on insert and whenever class_id is written: a blank price is filled
-- from the class's course. An explicit price (custom, pro-rated, a carried
-- 1:1 rate) is never touched. A course with no price (most 1:1s are priced
-- per family) leaves it blank, as before.
create or replace function public.enrolment_default_price() returns trigger
language plpgsql as $$
begin
  if new.price is null and new.class_id is not null then
    select co.course_price into new.price
      from public.classes c join public.courses co on co.id = c.course_id
     where c.id = new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists enrolment_default_price on public.enrolments;
create trigger enrolment_default_price
  before insert or update of class_id on public.enrolments
  for each row execute function public.enrolment_default_price();

-- Backfill: blank-priced enrolments whose course has a price (applied
-- 2026-10-09: Max Morrison, Daniel Leon Tjandra, Isabella Wang — Term 4 trials).
update public.enrolments e
   set price = co.course_price
  from public.classes c join public.courses co on co.id = c.course_id
 where c.id = e.class_id and e.price is null and co.course_price is not null;
