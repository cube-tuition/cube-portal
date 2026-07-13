-- Enrolments created without an explicit price default to the class's course
-- price (several flows — draft timetable apply, explorer add-to-class — insert
-- without one, which billed as $0 / showed null in the explorer). An explicit
-- price still wins: the trigger only fills NULLs. 1:1 classes with no course
-- price stay null and need a manually set fee.

create or replace function public.enrolments_default_price()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.price is null and new.class_id is not null then
    select co.course_price into new.price
    from classes c
    join courses co on co.id = c.course_id
    where c.id = new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists enrolments_default_price on public.enrolments;
create trigger enrolments_default_price
  before insert on public.enrolments
  for each row execute function public.enrolments_default_price();

-- Backfill existing null-price enrolments from their class's course price.
update public.enrolments e
set price = co.course_price
from public.classes c
join public.courses co on co.id = c.course_id
where c.id = e.class_id
  and e.price is null
  and co.course_price is not null;
