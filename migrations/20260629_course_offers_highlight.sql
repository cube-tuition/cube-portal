-- A prominent, editable "special offer" line for course-offer emails, rendered
-- as a highlighted banner at the top of the email (separate from the body).
alter table public.course_offers add column if not exists offer_highlight text not null default '';
