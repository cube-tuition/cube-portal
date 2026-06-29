-- Editable Active/Inactive dropdown on students, kept two-way in sync with
-- `status` via a trigger so it can never drift:
--   • status active/trial  → is_active 'Active'
--   • status disenrol/quit  → is_active 'Inactive'
--   • picking 'Inactive' in the dropdown sets status = 'disenrol'
--   • picking 'Active' on a disenrolled student sets status = 'active' (trial preserved)
alter table public.students drop column if exists is_active;

alter table public.students add column is_active text;
update public.students set is_active = case when status in ('active','trial') then 'Active' else 'Inactive' end;
alter table public.students
  add constraint students_is_active_check check (is_active in ('Active','Inactive'));

create or replace function public.students_sync_is_active()
returns trigger language plpgsql as $$
begin
  -- Dropdown changed on its own → map it onto status.
  if TG_OP = 'UPDATE'
     and NEW.status is not distinct from OLD.status
     and NEW.is_active is distinct from OLD.is_active then
    if NEW.is_active = 'Inactive' then
      NEW.status := 'disenrol';
    elsif NEW.is_active = 'Active' and OLD.status not in ('active','trial') then
      NEW.status := 'active';
    end if;
  end if;
  -- is_active always mirrors the final status.
  NEW.is_active := case when NEW.status in ('active','trial') then 'Active' else 'Inactive' end;
  return NEW;
end $$;

drop trigger if exists students_sync_is_active on public.students;
create trigger students_sync_is_active
  before insert or update on public.students
  for each row execute function public.students_sync_is_active();
