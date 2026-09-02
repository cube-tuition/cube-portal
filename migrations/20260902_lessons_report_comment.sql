-- Teacher's comment to the parents on a level-test lesson — typed on the
-- marking page, included in the feedback email body above the sign-off.
alter table public.lessons add column if not exists report_comment text;
