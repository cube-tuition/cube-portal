-- A course offer's call to action is per-offer.
--
-- The body's {{cta_button}} used to be hardwired to the website's free-trial
-- form, which is right for most offers and wrong for one: Y11 Chemistry has
-- limited spots and wants an expression-of-interest form instead. Rather than
-- branch on the offer inside the email builder, each offer carries its own
-- button label and destination; null means the free-trial default.
alter table course_offers
  add column if not exists cta_label text,
  add column if not exists cta_url   text;

comment on column course_offers.cta_label is
  'Button text for this offer. Null = "Book a free trial →".';
comment on column course_offers.cta_url is
  'Where the button goes. Null = the website free-trial form (lib/forms FREE_TRIAL_URL).';
