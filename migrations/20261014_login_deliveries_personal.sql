-- Password resets and login details can go to the student's own address.
--
-- Many students' logins are CUBE-issued usernames (name@cubetuition.com) with
-- no mailbox, so "email the student" was never offered — only the parent or a
-- link handed over in person — even for students with a real address of their
-- own on their record (students.email, e.g. Siwoo Paek). The reset and
-- login-details routes now offer it as 'personal'; this lets the delivery log
-- record it.
alter table public.login_deliveries drop constraint if exists login_deliveries_channel_check;
alter table public.login_deliveries add constraint login_deliveries_channel_check
  check (channel = any (array['account', 'personal', 'guardian', 'link']));
