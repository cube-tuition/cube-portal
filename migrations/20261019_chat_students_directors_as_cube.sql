-- Student messaging: directors speak as CUBE.
--
-- In the student-facing chat (chat_channels.audience = 'students' — class
-- channels and CUBE's threads with a student), a director's message always
-- shows as CUBE. The one exception is a class channel whose class the
-- director teaches: there they are the teacher, so their own name shows.
-- "Teaches" is the class's main teacher, resolved from classes.teacher the
-- same way chat_class_channel adds the teacher to the channel.
--
-- Enforced here (a BEFORE INSERT trigger on messages and scheduled messages)
-- rather than only in the composer, so every path — the chat screen, the
-- scheduled-delivery job, anything later — gets the same answer.

create or replace function public.chat_students_persona() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_audience text; v_class integer; v_teacher uuid; v_sender uuid;
begin
  v_sender := coalesce(new.sender_id, auth.uid());
  if v_sender is null or not exists (select 1 from public.directors d where d.id = v_sender) then return new; end if;
  select audience, class_id into v_audience, v_class from public.chat_channels where id = new.channel_id;
  if v_audience is distinct from 'students' then return new; end if;
  if v_class is not null then
    select public.resolve_tutor_by_first_name(c.teacher) into v_teacher from public.classes c where c.id = v_class;
    if v_teacher = v_sender then
      new.as_cube := false;
      return new;
    end if;
  end if;
  new.as_cube := true;
  new.sender_name := 'CUBE';
  return new;
end $$;

drop trigger if exists chat_messages_students_persona on public.chat_messages;
create trigger chat_messages_students_persona before insert on public.chat_messages
  for each row execute function public.chat_students_persona();

drop trigger if exists chat_scheduled_students_persona on public.chat_scheduled_messages;
create trigger chat_scheduled_students_persona before insert on public.chat_scheduled_messages
  for each row execute function public.chat_students_persona();

-- Messages already sent by a director in student chat follow the same rule.
update public.chat_messages m set as_cube = true, sender_name = 'CUBE'
  from public.chat_channels ch
 where ch.id = m.channel_id and ch.audience = 'students'
   and exists (select 1 from public.directors d where d.id = m.sender_id)
   and not m.as_cube
   and not (ch.class_id is not null
            and (select public.resolve_tutor_by_first_name(c.teacher) from public.classes c where c.id = ch.class_id) = m.sender_id);
