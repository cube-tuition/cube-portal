create sequence cash_log_id_seq;
create sequence chat_message_history_id_seq;
create sequence classes_id_seq;
create sequence courses_id_seq;
create sequence fixed_costs_id_seq;
create sequence guardians_id_seq;
create sequence invoices_id_seq;
create sequence lessons_id_seq;
create sequence student_classes_id_seq;
create sequence student_credits_id_seq;
create sequence trial_submissions_id_seq;

create table public.terms (
  id uuid default gen_random_uuid() not null,
  name text not null,
  year integer not null,
  term_number integer not null,
  start_date date not null,
  end_date date not null,
  created_at timestamp with time zone default now(),
  published_on_website boolean default false not null,
  constraint terms_pkey PRIMARY KEY (id)
);

create table public.tutors (
  id uuid default gen_random_uuid() not null,
  full_name text,
  email text,
  university text,
  gender text,
  phone text,
  pay_method text default 'bank'::text,
  cash_pay_weekday smallint,
  active boolean default true not null,
  tutor_code text,
  availability_updated_at timestamp with time zone,
  availability_updated_by text,
  system boolean default false not null,
  started_on date,
  constraint tutors_tutor_code_key UNIQUE (tutor_code),
  constraint tutors_pkey PRIMARY KEY (id),
  constraint tutors_cash_pay_weekday_check CHECK (((cash_pay_weekday IS NULL) OR ((cash_pay_weekday >= 1) AND (cash_pay_weekday <= 7)))),
  constraint tutors_pay_method_check CHECK ((pay_method = ANY (ARRAY['cash'::text, 'bank'::text])))
);

create table public.directors (
  id uuid default gen_random_uuid() not null,
  full_name text,
  email text,
  school text,
  gender text,
  phone text,
  pay_method text default 'bank'::text,
  cash_pay_weekday smallint,
  started_on date,
  constraint admins_pkey PRIMARY KEY (id)
);

create table public.courses (
  id integer default nextval('courses_id_seq'::regclass) not null,
  course_name text not null,
  course_code text not null,
  created_at timestamp with time zone default now() not null,
  course_price numeric(8,2),
  delivery_mode text default 'Class'::text,
  active boolean default true not null,
  constraint courses_course_code_key UNIQUE (course_code),
  constraint courses_pkey PRIMARY KEY (id),
  constraint courses_delivery_mode_check CHECK ((delivery_mode = ANY (ARRAY['1:1'::text, 'Class'::text])))
);

create table public.classes (
  id integer default nextval('classes_id_seq'::regclass) not null,
  class_name text,
  day_of_week text,
  start_time text,
  end_time text,
  teacher text,
  room text,
  term_id uuid,
  course_id integer,
  source_class_id integer,
  status text default 'active'::text not null,
  materials_owner text,
  constraint classes_pkey PRIMARY KEY (id),
  constraint classes_materials_owner_check CHECK ((materials_owner = ANY (ARRAY['Ryan'::text, 'Aiden'::text]))),
  constraint classes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

create table public.enrolments (
  id integer default nextval('student_classes_id_seq'::regclass) not null,
  student_id uuid,
  class_id integer,
  price numeric(8,2),
  status text default 'active'::text not null,
  trial_start_date date,
  created_at timestamp with time zone default now(),
  ended_at date,
  end_reason text,
  next_term_status text default 'pending'::text not null,
  started_at date,
  constraint student_classes_student_id_class_id_key UNIQUE (student_id, class_id),
  constraint student_classes_pkey PRIMARY KEY (id),
  constraint enrolments_next_term_status_check CHECK ((next_term_status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'not_continuing'::text]))),
  constraint enrolments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trial'::text, 'trial complete'::text, 'disenrol'::text])))
);

create table public.lessons (
  id integer default nextval('lessons_id_seq'::regclass) not null,
  class_id integer,
  lesson_date date not null,
  start_time text,
  end_time text,
  room text,
  status text default 'scheduled'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  week integer,
  main_teacher text,
  scheduled_teacher_id uuid,
  is_makeup boolean default false not null,
  makeup_student_id uuid,
  makeup_source_lesson_id integer,
  notes_general text,
  notes_workbook text,
  notes_homework text,
  has_rq boolean,
  lesson_type text,
  level_test_build_id uuid,
  student_name text,
  level_test_build_ids uuid[],
  report_comment text,
  report_emailed_at timestamp with time zone,
  report_emailed_to text,
  report_emailed_with integer[],
  report_comments jsonb default '{}'::jsonb not null,
  report_family_comment text,
  constraint lessons_pkey PRIMARY KEY (id),
  constraint lessons_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'rescheduled'::text])))
);

create table public.attendance (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  class_id integer not null,
  session_date date not null,
  status text default 'present'::text not null,
  notes text,
  created_at timestamp with time zone default now(),
  makeup_class_id integer,
  trial_feedback text,
  saved_by text,
  saved_at timestamp with time zone,
  constraint attendance_pkey PRIMARY KEY (id),
  constraint attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'late'::text, 'absent'::text, 'makeup'::text, 'cancelled'::text])))
);

create table public.dropin_sessions (
  id uuid default gen_random_uuid() not null,
  session_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  location text default 'Chatswood centre'::text,
  subjects text[] default '{}'::text[],
  tutors text[] default '{}'::text[],
  notes text,
  created_at timestamp with time zone default now(),
  max_capacity integer default 5 not null,
  year_groups text[],
  series_id uuid,
  constraint dropin_sessions_pkey PRIMARY KEY (id)
);

create table public.tutor_rate_matrix (
  id uuid default gen_random_uuid() not null,
  tutor_id uuid not null,
  year_band text not null,
  mode text not null,
  hourly_rate numeric(10,2) not null,
  effective_from date default '1970-01-01'::date not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  constraint tutor_rate_matrix_tutor_id_year_band_mode_effective_from_key UNIQUE (tutor_id, year_band, mode, effective_from),
  constraint tutor_rate_matrix_pkey PRIMARY KEY (id),
  constraint tutor_rate_matrix_hourly_rate_check CHECK ((hourly_rate >= (0)::numeric)),
  constraint tutor_rate_matrix_mode_check CHECK ((mode = ANY (ARRAY['class'::text, 'tutor'::text]))),
  constraint tutor_rate_matrix_year_band_check CHECK ((year_band = ANY (ARRAY['1-6'::text, '7-8'::text, '9-10'::text, '11-12'::text, 'other'::text])))
);

create table public.pay_runs (
  id uuid default gen_random_uuid() not null,
  period_start date not null,
  period_end date not null,
  status text default 'open'::text not null,
  total_hours numeric(10,2) default 0 not null,
  total_amount numeric(12,2) default 0 not null,
  created_at timestamp with time zone default now() not null,
  approved_at timestamp with time zone,
  approved_by uuid,
  exported_at timestamp with time zone,
  paid_at timestamp with time zone,
  notes text,
  constraint pay_runs_period_start_period_end_key UNIQUE (period_start, period_end),
  constraint pay_runs_pkey PRIMARY KEY (id),
  constraint pay_runs_check CHECK ((period_end > period_start)),
  constraint pay_runs_status_check CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'exported'::text, 'paid'::text, 'void'::text])))
);

create table public.shifts (
  id uuid default gen_random_uuid() not null,
  tutor_id uuid not null,
  work_date date not null,
  start_time time without time zone,
  end_time time without time zone,
  hours numeric(5,2) not null,
  kind text not null,
  source_table text,
  source_id text,
  rate_snapshot numeric(10,2),
  notes text,
  status text default 'draft'::text not null,
  submitted_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by uuid,
  pay_run_id uuid,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  updated_at timestamp with time zone default now() not null,
  xero_pay_run_id text,
  constraint shifts_pkey PRIMARY KEY (id),
  constraint shifts_hours_check CHECK (((hours > (0)::numeric) AND (hours <= (24)::numeric))),
  constraint shifts_kind_check CHECK ((kind = ANY (ARRAY['class'::text, 'dropin'::text, 'admin'::text, 'other'::text]))),
  constraint shifts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'paid'::text, 'void'::text])))
);

create table public.invoice_sync_queue (
  id bigint generated always as identity not null,
  student_id uuid not null,
  class_id integer not null,
  queued_at timestamp with time zone default now() not null,
  constraint invoice_sync_queue_pkey PRIMARY KEY (id)
);

create table public.cash_log (
  id integer default nextval('cash_log_id_seq'::regclass) not null,
  date date not null,
  direction text not null,
  type text not null,
  description text,
  amount numeric(10,2) not null,
  term_id uuid,
  created_at timestamp with time zone default now(),
  invoice_id integer,
  constraint cash_log_pkey PRIMARY KEY (id),
  constraint cash_log_direction_check CHECK ((direction = ANY (ARRAY['inflow'::text, 'outflow'::text])))
);

create table public.director_balances (
  id uuid default gen_random_uuid() not null,
  staff_id uuid not null,
  staff_name text not null,
  date date default CURRENT_DATE not null,
  kind text not null,
  amount numeric(10,2) not null,
  description text default ''::text not null,
  pay_run_id uuid,
  cash_log_out_id integer,
  cash_log_in_id integer,
  cash_pay_status_id uuid,
  created_by text,
  created_at timestamp with time zone default now() not null,
  constraint director_balances_pkey PRIMARY KEY (id),
  constraint director_balances_amount_check CHECK ((amount > (0)::numeric)),
  constraint director_balances_kind_check CHECK ((kind = ANY (ARRAY['debt'::text, 'offset'::text, 'repayment'::text])))
);

create table public.students (
  id uuid default gen_random_uuid() not null,
  full_name text,
  email text,
  school text,
  year text,
  gender text,
  phone text,
  family_id integer,
  status text default 'active'::text not null,
  payment_method text default 'bank'::text not null,
  notes text,
  constraint students_pkey PRIMARY KEY (id),
  constraint students_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'bank'::text]))),
  constraint students_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'trial'::text, 'inactive'::text])))
);

create table public.guardians (
  id integer default nextval('guardians_id_seq'::regclass) not null,
  full_name text,
  email text,
  phone text,
  created_at timestamp with time zone default now() not null,
  relationship text,
  student_id uuid,
  constraint guardians_pkey PRIMARY KEY (id)
);

create table public.invoices (
  id integer default nextval('invoices_id_seq'::regclass) not null,
  term_id uuid not null,
  family_id integer,
  student_id uuid,
  subtotal numeric(8,2) default 0 not null,
  sibling_discount numeric(8,2) default 0 not null,
  total numeric(8,2) default 0 not null,
  status text default 'unpaid'::text not null,
  notes text,
  created_at timestamp with time zone default now(),
  multi_course_discount numeric(8,2) default 0 not null,
  xero_invoice_id text,
  xero_contact_id text,
  xero_pushed_at timestamp with time zone,
  generated_at timestamp with time zone default now(),
  is_topup boolean default false,
  email_sent boolean default false not null,
  email_sent_at timestamp with time zone,
  invoice_number text,
  due_date date,
  xero_invoice_number text,
  xero_status text,
  pdf_path text,
  line_items jsonb,
  payment_instructions text,
  approved_at timestamp with time zone,
  approved_by uuid,
  delivery_status text default 'unsent'::text not null,
  payment_status text,
  reference_code text,
  payment_method text default 'bank'::text,
  reminder_sent_at timestamp with time zone,
  paid_date date,
  receipt_sent_at timestamp with time zone,
  xero_payment_id text,
  updated_since_sent boolean default false not null,
  change_summary jsonb default '[]'::jsonb not null,
  sent_snapshot jsonb,
  constraint invoices_invoice_number_key UNIQUE (invoice_number),
  constraint invoices_pkey PRIMARY KEY (id),
  constraint invoice_target CHECK ((((family_id IS NOT NULL) AND (student_id IS NULL)) OR ((family_id IS NULL) AND (student_id IS NOT NULL)))),
  constraint invoices_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['unsent'::text, 'sent'::text]))),
  constraint invoices_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'bank'::text]))),
  constraint invoices_payment_status_check CHECK (((payment_status IS NULL) OR (payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'overdue'::text])))),
  constraint invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'synced_to_xero'::text, 'voided'::text])))
);

create table public.student_credits (
  id integer default nextval('student_credits_id_seq'::regclass) not null,
  student_id uuid not null,
  amount numeric(10,2) not null,
  reason text not null,
  notes text,
  invoice_id integer,
  created_at timestamp with time zone default now(),
  created_by uuid,
  constraint student_credits_pkey PRIMARY KEY (id),
  constraint student_credits_amount_check CHECK ((amount > (0)::numeric))
);

create table public.fixed_costs (
  id integer default nextval('fixed_costs_id_seq'::regclass) not null,
  name text not null,
  amount numeric(10,2) default 0 not null,
  frequency text default 'yearly'::text not null,
  created_at timestamp with time zone default now(),
  constraint fixed_costs_pkey PRIMARY KEY (id),
  constraint fixed_costs_frequency_check CHECK ((frequency = ANY (ARRAY['monthly'::text, 'yearly'::text])))
);

create table public.cash_pay_status (
  id uuid default gen_random_uuid() not null,
  pay_run_id uuid not null,
  tutor_id uuid not null,
  amount numeric default 0 not null,
  cash_log_id integer,
  paid_at timestamp with time zone default now() not null,
  paid_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint cash_pay_status_pay_run_id_tutor_id_key UNIQUE (pay_run_id, tutor_id),
  constraint cash_pay_status_pkey PRIMARY KEY (id)
);

create table public.portal_settings (
  key text not null,
  value text,
  updated_at timestamp with time zone default now(),
  constraint portal_settings_pkey PRIMARY KEY (key)
);

create table public.qbank_questions (
  id uuid default gen_random_uuid() not null,
  skill_id uuid,
  stem_latex text default ''::text not null,
  solution_latex text default ''::text not null,
  difficulty integer default 3 not null,
  marks integer,
  is_multipart boolean default false not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  qtype text default 'extended'::text not null,
  options jsonb default '[]'::jsonb not null,
  correct_option text,
  criteria jsonb default '{}'::jsonb not null,
  topic_id uuid,
  audience text default 'exam'::text not null,
  subtopic_id uuid,
  math_obj jsonb,
  stimulus_latex text,
  constraint qbank_questions_pkey PRIMARY KEY (id),
  constraint qbank_questions_audience_check CHECK ((audience = ANY (ARRAY['exam'::text, 'student'::text]))),
  constraint qbank_questions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5))),
  constraint qbank_questions_qtype_check CHECK ((qtype = ANY (ARRAY['extended'::text, 'mcq'::text])))
);

create table public.qbank_question_parts (
  id uuid default gen_random_uuid() not null,
  question_id uuid not null,
  part_label text,
  prompt_latex text default ''::text not null,
  solution_latex text default ''::text not null,
  marks integer,
  sort_order integer default 0 not null,
  criteria jsonb default '{}'::jsonb not null,
  topic_id uuid,
  subtopic_id uuid,
  constraint qbank_question_parts_pkey PRIMARY KEY (id)
);

create table public.qbank_question_images (
  id uuid default gen_random_uuid() not null,
  question_id uuid,
  part_id uuid,
  storage_path text not null,
  alt text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  role text default 'stem'::text not null,
  constraint qbank_question_images_pkey PRIMARY KEY (id)
);

create table public.online_resources (
  id uuid default gen_random_uuid() not null,
  title text not null,
  url text not null,
  resource_type text default 'Website'::text not null,
  year integer,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint online_resources_pkey PRIMARY KEY (id)
);

create table public.stimulus_texts (
  id uuid default gen_random_uuid() not null,
  title text not null,
  source text,
  text_type text default 'Poem'::text not null,
  year integer,
  body text default ''::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  two_col boolean default false not null,
  constraint stimulus_texts_pkey PRIMARY KEY (id)
);

create table public.job_runs (
  id bigint generated always as identity not null,
  job text not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone default now() not null,
  ok boolean not null,
  detail jsonb,
  error text,
  constraint job_runs_pkey PRIMARY KEY (id)
);

create table public.trial_submissions (
  id integer default nextval('trial_submissions_id_seq'::regclass) not null,
  submitted_at timestamp with time zone default now() not null,
  student_name text,
  student_year text,
  school text,
  subjects text[],
  day_preference text,
  time_preference text,
  parent_name text,
  parent_email text,
  parent_phone text,
  how_heard text,
  status text default 'new'::text not null,
  admin_notes text,
  trial_date date,
  trial_class_id integer,
  contacted_at timestamp with time zone,
  converted_at timestamp with time zone,
  converted_student_id uuid,
  source text default 'website_form'::text not null,
  student_email text,
  student_phone text,
  availability jsonb,
  relationship text,
  notes text,
  enrolment_id integer,
  referred_by text,
  referrer_student_id uuid,
  referrer_outside boolean default false not null,
  invitation_sent_at timestamp with time zone,
  reminder_sent_at timestamp with time zone,
  last_activity_at timestamp with time zone,
  stale_notified_at timestamp with time zone,
  lesson1_feedback_sent_at timestamp with time zone,
  outcome_sent_at timestamp with time zone,
  level_test_invitation_sent_at timestamp with time zone,
  held_at timestamp with time zone,
  hold_until date,
  hold_notified_at timestamp with time zone,
  constraint trial_submissions_pkey PRIMARY KEY (id),
  constraint trial_submissions_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'trial_scheduled'::text, 'trial_1_completed'::text, 'trial_completed'::text, 'on_hold'::text, 'enrolled'::text, 'declined'::text])))
);

create table public.qbank_subjects (
  id uuid default gen_random_uuid() not null,
  year_level integer not null,
  name text not null,
  code text,
  sort_order integer default 0 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint qbank_subjects_pkey PRIMARY KEY (id)
);

create table public.practice_ratings (
  id bigint generated always as identity not null,
  student_id uuid not null,
  question_id uuid not null,
  rating text not null,
  rated_at timestamp with time zone default now() not null,
  constraint practice_ratings_pkey PRIMARY KEY (id),
  constraint practice_ratings_rating_check CHECK ((rating = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text, 'very_hard'::text])))
);

create table public.qbank_topics (
  id uuid default gen_random_uuid() not null,
  subject_id uuid not null,
  name text not null,
  sort_order integer default 0 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint qbank_topics_pkey PRIMARY KEY (id)
);

create table public.qbank_skills (
  id uuid default gen_random_uuid() not null,
  topic_id uuid,
  name text not null,
  sort_order integer default 0 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  subtopic_id uuid,
  subject_id uuid,
  family text,
  stage text,
  constraint qbank_skills_pkey PRIMARY KEY (id),
  constraint qbank_skills_family_check CHECK (((family IS NULL) OR (family = ANY (ARRAY['Maths'::text, 'English'::text, 'Chemistry'::text])))),
  constraint qbank_skills_stage_check CHECK (((stage IS NULL) OR (stage = ANY (ARRAY['primary'::text, 'high'::text]))))
);

create table public.qbank_subtopics (
  id uuid default gen_random_uuid() not null,
  topic_id uuid not null,
  name text not null,
  sort_order integer default 0 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  syllabus_dotpoint_id uuid,
  constraint qbank_subtopics_pkey PRIMARY KEY (id)
);

create table public.qbank_question_subtopics (
  question_id uuid not null,
  subtopic_id uuid not null,
  constraint qbank_question_subtopics_pkey PRIMARY KEY (question_id, subtopic_id)
);

create table public.qbank_subject_links (
  subject_id uuid not null,
  shows_subject_id uuid not null,
  constraint qbank_subject_links_pkey PRIMARY KEY (subject_id, shows_subject_id),
  constraint qbank_subject_links_check CHECK ((subject_id <> shows_subject_id))
);

create table public.level_test_invites (
  id uuid default gen_random_uuid() not null,
  token text not null,
  submission_id integer not null,
  student_id uuid,
  student_name text,
  build_ids uuid[] default '{}'::uuid[] not null,
  slots jsonb default '[]'::jsonb not null,
  lesson_id integer,
  chosen_slot jsonb,
  parent_note text,
  sent_at timestamp with time zone,
  responded_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint level_test_invites_submission_id_key UNIQUE (submission_id),
  constraint level_test_invites_token_key UNIQUE (token),
  constraint level_test_invites_pkey PRIMARY KEY (id)
);

create table public.auto_reminders (
  key text not null,
  kind text not null,
  submission_id integer,
  to_email text,
  starts_at timestamp with time zone,
  sent_at timestamp with time zone default now() not null,
  constraint auto_reminders_pkey PRIMARY KEY (key),
  constraint auto_reminders_kind_check CHECK ((kind = ANY (ARRAY['trial'::text, 'level_test'::text])))
);

create table public.trial_invites (
  id uuid default gen_random_uuid() not null,
  token text not null,
  submission_ids integer[] default '{}'::integer[] not null,
  parent_email text,
  parent_name text,
  student_name text,
  sections jsonb default '[]'::jsonb not null,
  picks jsonb default '{}'::jsonb not null,
  note text,
  source text default 'invitation'::text not null,
  created_at timestamp with time zone default now() not null,
  responded_at timestamp with time zone,
  constraint trial_invites_token_key UNIQUE (token),
  constraint trial_invites_pkey PRIMARY KEY (id),
  constraint trial_invites_source_check CHECK ((source = ANY (ARRAY['invitation'::text, 'level_test'::text])))
);

create table public.chat_channels (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  name text default ''::text not null,
  dm_key text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  is_default boolean default false not null,
  directors_only boolean default false not null,
  quiet boolean default false not null,
  audience text default 'staff'::text not null,
  class_id integer,
  student_replies boolean default false not null,
  archived_at timestamp with time zone,
  student_visible boolean default true not null,
  constraint chat_channels_dm_key_key UNIQUE (dm_key),
  constraint chat_channels_pkey PRIMARY KEY (id),
  constraint chat_channels_audience_check CHECK ((audience = ANY (ARRAY['staff'::text, 'students'::text]))),
  constraint chat_channels_kind_check CHECK ((kind = ANY (ARRAY['channel'::text, 'dm'::text, 'cube_dm'::text])))
);

create table public.chat_members (
  channel_id uuid not null,
  user_id uuid not null,
  joined_at timestamp with time zone default now() not null,
  muted boolean default false not null,
  constraint chat_members_pkey PRIMARY KEY (channel_id, user_id)
);

create table public.chat_messages (
  id uuid default gen_random_uuid() not null,
  channel_id uuid not null,
  sender_id uuid not null,
  sender_name text default ''::text not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  as_cube boolean default false not null,
  constraint chat_messages_pkey PRIMARY KEY (id)
);

create table public.chat_reads (
  channel_id uuid not null,
  user_id uuid not null,
  last_read_at timestamp with time zone default now() not null,
  constraint chat_reads_pkey PRIMARY KEY (channel_id, user_id)
);

create table public.chat_reactions (
  message_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamp with time zone default now() not null,
  constraint chat_reactions_pkey PRIMARY KEY (message_id, user_id, emoji),
  constraint chat_reactions_emoji_check CHECK (((length(emoji) >= 1) AND (length(emoji) <= 16)))
);

create table public.chat_scheduled_messages (
  id uuid default gen_random_uuid() not null,
  channel_id uuid not null,
  sender_id uuid default auth.uid() not null,
  sender_name text default ''::text not null,
  body text not null,
  as_cube boolean default false not null,
  send_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone,
  sent_message_id uuid,
  error text,
  constraint chat_scheduled_messages_pkey PRIMARY KEY (id),
  constraint chat_scheduled_messages_body_check CHECK ((length(btrim(body)) > 0))
);

create table public.chat_reports (
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  channel_id uuid not null,
  reported_by uuid not null,
  reason text,
  body_snapshot text,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  constraint chat_reports_message_id_reported_by_key UNIQUE (message_id, reported_by),
  constraint chat_reports_pkey PRIMARY KEY (id)
);

create table public.chat_message_history (
  id bigint default nextval('chat_message_history_id_seq'::regclass) not null,
  message_id uuid not null,
  channel_id uuid not null,
  body text not null,
  action text not null,
  changed_by uuid,
  changed_at timestamp with time zone default now() not null,
  constraint chat_message_history_pkey PRIMARY KEY (id),
  constraint chat_message_history_action_check CHECK ((action = ANY (ARRAY['edited'::text, 'deleted'::text])))
);

create table public.lesson_prep (
  lesson_id integer not null,
  prepared_by uuid,
  prepared_by_name text,
  prepared_at timestamp with time zone,
  printed_at timestamp with time zone,
  printed_by_name text,
  constraint lesson_prep_pkey PRIMARY KEY (lesson_id)
);

create table public.chat_stars (
  user_id uuid default auth.uid() not null,
  channel_id uuid not null,
  starred_at timestamp with time zone default now() not null,
  constraint chat_stars_pkey PRIMARY KEY (user_id, channel_id)
);

alter table public.attendance add constraint attendance_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
alter table public.attendance add constraint attendance_makeup_class_id_fkey FOREIGN KEY (makeup_class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.attendance add constraint attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.auto_reminders add constraint auto_reminders_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES trial_submissions(id) ON DELETE SET NULL;
alter table public.cash_log add constraint cash_log_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public.cash_log add constraint cash_log_term_id_fkey FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE SET NULL;
alter table public.cash_pay_status add constraint cash_pay_status_cash_log_id_fkey FOREIGN KEY (cash_log_id) REFERENCES cash_log(id) ON DELETE SET NULL;
alter table public.cash_pay_status add constraint cash_pay_status_pay_run_id_fkey FOREIGN KEY (pay_run_id) REFERENCES pay_runs(id) ON DELETE CASCADE;
alter table public.chat_members add constraint chat_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_message_history add constraint chat_message_history_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;
alter table public.chat_messages add constraint chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_reactions add constraint chat_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;
alter table public.chat_reads add constraint chat_reads_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_reports add constraint chat_reports_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_reports add constraint chat_reports_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;
alter table public.chat_scheduled_messages add constraint chat_scheduled_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.chat_scheduled_messages add constraint chat_scheduled_messages_sent_message_id_fkey FOREIGN KEY (sent_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
alter table public.chat_stars add constraint chat_stars_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE;
alter table public.classes add constraint classes_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id);
alter table public.classes add constraint classes_source_class_id_fkey FOREIGN KEY (source_class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.classes add constraint classes_term_id_fkey FOREIGN KEY (term_id) REFERENCES terms(id);
alter table public.director_balances add constraint director_balances_cash_log_in_id_fkey FOREIGN KEY (cash_log_in_id) REFERENCES cash_log(id) ON DELETE SET NULL;
alter table public.director_balances add constraint director_balances_cash_log_out_id_fkey FOREIGN KEY (cash_log_out_id) REFERENCES cash_log(id) ON DELETE SET NULL;
alter table public.director_balances add constraint director_balances_cash_pay_status_id_fkey FOREIGN KEY (cash_pay_status_id) REFERENCES cash_pay_status(id) ON DELETE SET NULL;
alter table public.director_balances add constraint director_balances_pay_run_id_fkey FOREIGN KEY (pay_run_id) REFERENCES pay_runs(id) ON DELETE SET NULL;
alter table public.enrolments add constraint student_classes_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
alter table public.enrolments add constraint student_classes_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.guardians add constraint guardians_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id);
alter table public.invoices add constraint invoices_term_id_fkey FOREIGN KEY (term_id) REFERENCES terms(id);
alter table public.lesson_prep add constraint lesson_prep_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
alter table public.lessons add constraint lessons_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
alter table public.lessons add constraint lessons_makeup_source_lesson_id_fkey FOREIGN KEY (makeup_source_lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
alter table public.lessons add constraint lessons_makeup_student_id_fkey FOREIGN KEY (makeup_student_id) REFERENCES students(id) ON DELETE SET NULL;
alter table public.level_test_invites add constraint level_test_invites_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
alter table public.level_test_invites add constraint level_test_invites_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
alter table public.level_test_invites add constraint level_test_invites_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES trial_submissions(id) ON DELETE CASCADE;
alter table public.practice_ratings add constraint practice_ratings_question_id_fkey FOREIGN KEY (question_id) REFERENCES qbank_questions(id) ON DELETE CASCADE;
alter table public.practice_ratings add constraint practice_ratings_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.qbank_question_images add constraint qbank_question_images_part_id_fkey FOREIGN KEY (part_id) REFERENCES qbank_question_parts(id) ON DELETE CASCADE;
alter table public.qbank_question_images add constraint qbank_question_images_question_id_fkey FOREIGN KEY (question_id) REFERENCES qbank_questions(id) ON DELETE CASCADE;
alter table public.qbank_question_parts add constraint qbank_question_parts_question_id_fkey FOREIGN KEY (question_id) REFERENCES qbank_questions(id) ON DELETE CASCADE;
alter table public.qbank_question_parts add constraint qbank_question_parts_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES qbank_subtopics(id) ON DELETE SET NULL;
alter table public.qbank_question_parts add constraint qbank_question_parts_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES qbank_topics(id) ON DELETE SET NULL;
alter table public.qbank_question_subtopics add constraint qbank_question_subtopics_question_id_fkey FOREIGN KEY (question_id) REFERENCES qbank_questions(id) ON DELETE CASCADE;
alter table public.qbank_question_subtopics add constraint qbank_question_subtopics_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES qbank_subtopics(id) ON DELETE CASCADE;
alter table public.qbank_questions add constraint qbank_questions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES qbank_skills(id) ON DELETE SET NULL;
alter table public.qbank_questions add constraint qbank_questions_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES qbank_subtopics(id) ON DELETE SET NULL;
alter table public.qbank_questions add constraint qbank_questions_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES qbank_topics(id) ON DELETE SET NULL;
alter table public.qbank_skills add constraint qbank_skills_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES qbank_subjects(id) ON DELETE CASCADE;
alter table public.qbank_skills add constraint qbank_skills_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES qbank_subtopics(id) ON DELETE SET NULL;
alter table public.qbank_skills add constraint qbank_skills_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES qbank_topics(id) ON DELETE CASCADE;
alter table public.qbank_subject_links add constraint qbank_subject_links_shows_subject_id_fkey FOREIGN KEY (shows_subject_id) REFERENCES qbank_subjects(id) ON DELETE CASCADE;
alter table public.qbank_subject_links add constraint qbank_subject_links_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES qbank_subjects(id) ON DELETE CASCADE;
alter table public.qbank_subtopics add constraint qbank_subtopics_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES qbank_topics(id) ON DELETE CASCADE;
alter table public.qbank_topics add constraint qbank_topics_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES qbank_subjects(id) ON DELETE CASCADE;
alter table public.shifts add constraint shifts_pay_run_id_fkey FOREIGN KEY (pay_run_id) REFERENCES pay_runs(id) ON DELETE SET NULL;
alter table public.student_credits add constraint student_credits_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public.student_credits add constraint student_credits_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.trial_submissions add constraint trial_submissions_converted_student_id_fkey FOREIGN KEY (converted_student_id) REFERENCES students(id) ON DELETE SET NULL;
alter table public.trial_submissions add constraint trial_submissions_enrolment_id_fkey FOREIGN KEY (enrolment_id) REFERENCES enrolments(id) ON DELETE SET NULL;
alter table public.trial_submissions add constraint trial_submissions_referrer_student_id_fkey FOREIGN KEY (referrer_student_id) REFERENCES students(id);
alter table public.trial_submissions add constraint trial_submissions_trial_class_id_fkey FOREIGN KEY (trial_class_id) REFERENCES classes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX attendance_student_class_date_idx ON public.attendance USING btree (student_id, class_id, session_date);
CREATE UNIQUE INDEX cash_log_invoice_uniq ON public.cash_log USING btree (invoice_id) WHERE (invoice_id IS NOT NULL);
CREATE UNIQUE INDEX invoices_one_per_family_term ON public.invoices USING btree (term_id, family_id) WHERE ((status <> 'voided'::text) AND (family_id IS NOT NULL) AND (COALESCE(is_topup, false) = false));
CREATE UNIQUE INDEX invoices_one_per_student_term ON public.invoices USING btree (term_id, student_id) WHERE ((status <> 'voided'::text) AND (family_id IS NULL) AND (student_id IS NOT NULL) AND (COALESCE(is_topup, false) = false));
CREATE UNIQUE INDEX lessons_class_date_regular_idx ON public.lessons USING btree (class_id, lesson_date) WHERE (is_makeup = false);
CREATE UNIQUE INDEX qbank_skills_family_stage_name_key ON public.qbank_skills USING btree (family, stage, lower(name)) WHERE ((family IS NOT NULL) AND (stage IS NOT NULL));
CREATE UNIQUE INDEX qbank_subjects_year_name_uniq ON public.qbank_subjects USING btree (year_level, lower(name));
CREATE UNIQUE INDEX qbank_subtopics_topic_dotpoint_uniq ON public.qbank_subtopics USING btree (topic_id, syllabus_dotpoint_id) WHERE (syllabus_dotpoint_id IS NOT NULL);
CREATE UNIQUE INDEX shifts_source_uniq ON public.shifts USING btree (source_table, source_id) WHERE ((source_table IS NOT NULL) AND (source_id IS NOT NULL));
CREATE UNIQUE INDEX terms_year_number_idx ON public.terms USING btree (year, term_number);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_class_time(t text)
 RETURNS time without time zone
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  parts text[];
  h     int;
  m     int;
begin
  if t is null or btrim(t) = '' then return null; end if;
  parts := string_to_array(btrim(t), ':');
  begin
    h := parts[1]::int;
    m := coalesce(parts[2]::int, 0);
  exception when others then
    return null;
  end;
  if h between 1 and 7 then h := h + 12; end if;
  if h < 0 or h > 23 or m < 0 or m > 59 then return null; end if;
  return make_time(h, m, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_class_year(p_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(substring(coalesce(p_name,'') from '^[Yy](\d{1,2})'), '')::int;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_class_mode(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when coalesce(p_name,'') ~* '1\s*[:/]?\s*on\s*1|1\s*:\s*1' then 'tutor' else 'class' end;
$function$
;

CREATE OR REPLACE FUNCTION public.year_band_for(p_year integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_year between 1 and 6   then '1-6'
    when p_year between 7 and 8   then '7-8'
    when p_year between 9 and 10  then '9-10'
    when p_year between 11 and 12 then '11-12'
    else null
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','tutor','director'), false)
    or exists (
      select 1 from public.directors d
      where d.id = auth.uid()
         or lower(d.email) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
    or exists (
      select 1 from public.tutors t
      where t.id = auth.uid()
         or lower(t.email) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_tutor_by_first_name(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM (
    SELECT id, full_name FROM public.tutors
    UNION ALL
    SELECT id, full_name FROM public.directors
  ) staff
  WHERE lower(btrim(coalesce(full_name, ''))) = lower(btrim(coalesce(p_name, '')))
     OR lower(split_part(coalesce(full_name, ''), ' ', 1)) = lower(btrim(coalesce(p_name, '')))
  ORDER BY (lower(btrim(coalesce(full_name, ''))) = lower(btrim(coalesce(p_name, '')))) DESC, id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_matrix_rate(p_tutor uuid, p_class_name text, p_on date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  -- Year-less class names fall back to the 'other' band.
  v_band text := coalesce(public.year_band_for(public.parse_class_year(p_class_name)), 'other');
  v_mode text := public.parse_class_mode(p_class_name);
  v_rate numeric;
begin
  select hourly_rate into v_rate
  from public.tutor_rate_matrix
  where tutor_id = p_tutor
    and year_band = v_band
    and mode = v_mode
    and effective_from <= p_on
  order by effective_from desc
  limit 1;
  return v_rate;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dropin_rate_band(p_year_groups text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(
    (select case when count(distinct b) = 1 then min(b) else 'other' end
       from (
         select public.year_band_for(nullif(regexp_replace(y, '\D', '', 'g'), '')::int) as b
         from unnest(coalesce(p_year_groups, '{}'::text[])) as y
       ) t
      where b is not null),
    'other');
$function$
;

CREATE OR REPLACE FUNCTION public.dropin_matrix_rate(p_tutor uuid, p_year_groups text[], p_on date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select hourly_rate
  from public.tutor_rate_matrix
  where tutor_id = p_tutor
    and year_band = public.dropin_rate_band(p_year_groups)
    and mode = 'class'
    and effective_from <= p_on
  order by effective_from desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.current_tutor_rate(p_tutor uuid, p_on date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select public.dropin_matrix_rate(p_tutor, null::text[], p_on);
$function$
;

CREATE OR REPLACE FUNCTION public.pay_period_for(p_date date)
 RETURNS TABLE(period_start date, period_end date, fortnight_index integer, term_id uuid)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_term       public.terms%rowtype;
  v_start      date;
  v_next_start date;
  v_diff       int;
  v_idx        int;
begin
  -- Terms start on the Monday of their first week (date_trunc 'week'), the
  -- same rule the portal applies (lib/termDates), so a Tuesday-start term's
  -- Monday is fortnight 1 of the term, not the tail of the holidays.
  select * into v_term from public.terms
   where p_date between date_trunc('week', start_date)::date and end_date
     and coalesce(term_number, 0) <= 10
   order by start_date desc limit 1;
  if found then
    v_start := date_trunc('week', v_term.start_date)::date;
    v_diff := p_date - v_start;
    v_idx  := least(5, greatest(1, (v_diff / 14)::int + 1));
    period_start    := v_start + (v_idx - 1) * 14;
    period_end      := period_start + 13;
    fortnight_index := v_idx;
    term_id         := v_term.id;
    return next; return;
  end if;

  select * into v_term from public.terms
   where end_date < p_date and coalesce(term_number, 0) <= 10
   order by end_date desc limit 1;
  if found then
    select min(date_trunc('week', start_date)::date) into v_next_start from public.terms
     where start_date > v_term.end_date and coalesce(term_number, 0) <= 10;
    period_start    := v_term.end_date + 1;
    period_end      := coalesce(v_next_start - 1, v_term.end_date + 42);
    fortnight_index := 0;
    term_id         := v_term.id;
    return next; return;
  end if;

  select * into v_term from public.terms
   where coalesce(term_number, 0) <= 10 order by start_date asc limit 1;
  if not found then return; end if;
  period_start    := date_trunc('week', v_term.start_date)::date;
  period_end      := period_start + 13;
  fortnight_index := 1;
  term_id         := v_term.id;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lesson_main_teacher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.class_id is not null then
    select teacher into new.main_teacher from public.classes where id = new.class_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_shift_from_class_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_class        public.classes%rowtype;
  v_lesson       public.lessons%rowtype;
  v_tutor_id     uuid;
  v_start        time;
  v_end          time;
  v_hours        numeric(5,2);
  v_rate         numeric(10,2);
  v_source_key   text;
begin
  -- The student was moved to a make-up, or the lesson was cancelled for them:
  -- this session didn't run on their account, so it creates no shift — and if
  -- nobody else's mark says it ran, a draft shift made earlier goes too.
  if new.status in ('makeup', 'cancelled') then
    if not exists (select 1 from public.attendance a
                    where a.class_id = new.class_id and a.session_date = new.session_date
                      and a.status not in ('makeup', 'cancelled')) then
      perform public.drop_draft_class_shift(new.class_id, new.session_date);
    end if;
    return new;
  end if;

  select * into v_class from public.classes where id = new.class_id;
  if not found then return new; end if;

  select * into v_lesson
  from public.lessons
  where class_id = new.class_id and lesson_date = new.session_date
  order by coalesce(is_makeup, false), id
  limit 1;

  -- The lesson itself was cancelled: no pay for it, whatever the roll says.
  if v_lesson.status = 'cancelled' and not coalesce(v_lesson.is_makeup, false) then
    perform public.drop_draft_class_shift(new.class_id, new.session_date);
    return new;
  end if;

  v_tutor_id := v_lesson.scheduled_teacher_id;
  if v_tutor_id is null then
    v_tutor_id := public.resolve_tutor_by_first_name(v_class.teacher);
  end if;
  if v_tutor_id is null then return new; end if;

  if not exists (select 1 from public.tutors where id = v_tutor_id)
     and not exists (select 1 from public.directors where id = v_tutor_id) then
    return new;
  end if;

  v_start := coalesce(public.parse_class_time(v_lesson.start_time), public.parse_class_time(v_class.start_time));
  v_end   := coalesce(public.parse_class_time(v_lesson.end_time),   public.parse_class_time(v_class.end_time));
  if v_start is null or v_end is null then return new; end if;

  if v_end < v_start then v_end := v_end + interval '12 hours'; end if;

  v_hours := extract(epoch from (v_end - v_start)) / 3600.0;
  if v_hours <= 0 or v_hours > 12 then return new; end if;

  v_rate := public.resolve_matrix_rate(v_tutor_id, v_class.class_name, new.session_date);

  v_source_key := v_class.id::text || '_' || new.session_date::text;

  insert into public.shifts (
    tutor_id, work_date, start_time, end_time, hours, kind,
    source_table, source_id, rate_snapshot, notes, status, created_by
  )
  values (
    v_tutor_id, new.session_date, v_start, v_end, v_hours, 'class',
    'class_session', v_source_key, v_rate,
    'Auto: ' || coalesce(v_class.class_name, 'class #' || v_class.id::text),
    'draft', v_tutor_id
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    tutor_id      = excluded.tutor_id,
    start_time    = excluded.start_time,
    end_time      = excluded.end_time,
    hours         = excluded.hours,
    rate_snapshot = excluded.rate_snapshot,
    notes         = excluded.notes
  where shifts.status = 'draft';

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_shifts_from_dropin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name        text;
  v_tutor_id    uuid;
  v_hours       numeric(5,2);
  v_rate        numeric(10,2);
  v_source_key  text;
begin
  if new.tutors is null or array_length(new.tutors,1) is null then
    return new;
  end if;
  if new.start_time is null or new.end_time is null then return new; end if;

  v_hours := extract(epoch from (new.end_time - new.start_time)) / 3600.0;
  if v_hours <= 0 or v_hours > 12 then return new; end if;

  foreach v_name in array new.tutors loop
    if v_name is null or btrim(v_name) = '' then continue; end if;

    v_tutor_id := public.resolve_tutor_by_first_name(v_name);
    if v_tutor_id is null then continue; end if;

    v_rate := public.dropin_matrix_rate(v_tutor_id, new.year_groups, new.session_date);
    v_source_key := new.id::text || '_' || v_tutor_id::text;

    insert into public.shifts (
      tutor_id, work_date, start_time, end_time, hours, kind,
      source_table, source_id, rate_snapshot, notes, status, created_by
    )
    values (
      v_tutor_id, new.session_date, new.start_time, new.end_time, v_hours, 'dropin',
      'dropin_sessions', v_source_key, v_rate,
      'Auto: drop-in' || case when new.location is not null and new.location <> ''
                              then ' @ ' || new.location else '' end,
      'draft', v_tutor_id
    )
    on conflict (source_table, source_id)
      where source_table is not null and source_id is not null
    do nothing;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_dropin_shift(p_session_id uuid, p_start time without time zone DEFAULT NULL::time without time zone, p_end time without time zone DEFAULT NULL::time without time zone)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_sess   public.dropin_sessions%rowtype;
  v_name   text;
  v_listed boolean := false;
  v_hours  numeric(5,2);
  v_rate   numeric(10,2);
  v_key    text;
  v_row    public.shifts%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sess from public.dropin_sessions where id = p_session_id;
  if not found then
    raise exception 'That drop-in session no longer exists';
  end if;

  -- Only a tutor rostered on this drop-in may raise a shift for it. Names are
  -- stored as free text, so resolve each the same way the trigger does.
  foreach v_name in array coalesce(v_sess.tutors, '{}'::text[]) loop
    if public.resolve_tutor_by_first_name(v_name) = v_uid then
      v_listed := true;
    end if;
  end loop;
  if not v_listed then
    raise exception 'Only a tutor rostered on this drop-in can save its shift';
  end if;

  p_start := coalesce(p_start, v_sess.start_time);
  p_end   := coalesce(p_end,   v_sess.end_time);
  if p_start is null or p_end is null then
    raise exception 'This drop-in has no start or finish time';
  end if;

  -- The shift must sit inside the rostered session: start no earlier, finish no
  -- later. Shorter is fine — that is the whole point of letting them edit it.
  if p_start < v_sess.start_time then
    raise exception 'A drop-in shift cannot start before the session does (%)',
      to_char(v_sess.start_time, 'HH12:MIam');
  end if;
  if p_end > v_sess.end_time then
    raise exception 'A drop-in shift cannot run past the end of the session (%)',
      to_char(v_sess.end_time, 'HH12:MIam');
  end if;

  v_hours := extract(epoch from (p_end - p_start)) / 3600.0;
  if v_hours <= 0 then
    raise exception 'The finish time must be after the start time';
  end if;

  v_rate := public.dropin_matrix_rate(v_uid, v_sess.year_groups, v_sess.session_date);
  v_key  := v_sess.id::text || '_' || v_uid::text;

  insert into public.shifts (
    tutor_id, work_date, start_time, end_time, hours, kind,
    source_table, source_id, rate_snapshot, notes, status, created_by
  )
  values (
    v_uid, v_sess.session_date, p_start, p_end, v_hours, 'dropin',
    'dropin_sessions', v_key, v_rate,
    'Drop-in' || case when coalesce(v_sess.location, '') <> ''
                      then ' @ ' || v_sess.location else '' end,
    'draft', v_uid
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    start_time    = excluded.start_time,
    end_time      = excluded.end_time,
    hours         = excluded.hours,
    -- Keep whatever rate the shift was raised at; only fill a missing one.
    rate_snapshot = coalesce(public.shifts.rate_snapshot, excluded.rate_snapshot),
    notes         = excluded.notes
  -- An approved / paid / void shift is settled: never rewrite it from here.
  where public.shifts.status = 'draft'
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.shifts
    where source_table = 'dropin_sessions' and source_id = v_key;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_pay_run(p_date date DEFAULT CURRENT_DATE)
 RETURNS pay_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pp record;
  v_pr public.pay_runs%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pp from public.pay_period_for(p_date);

  insert into public.pay_runs (period_start, period_end, status)
  values (v_pp.period_start, v_pp.period_end, 'open')
  on conflict (period_start, period_end) do nothing;

  select * into v_pr from public.pay_runs
   where period_start = v_pp.period_start and period_end = v_pp.period_end;

  return v_pr;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_run_recompute_totals(p_pay_run uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;
  update public.pay_runs pr
     set total_hours  = coalesce(t.h, 0),
         total_amount = coalesce(t.a, 0)
    from (select coalesce(sum(hours),0)::numeric(10,2) as h,
                 coalesce(sum(hours * coalesce(rate_snapshot,0)),0)::numeric(12,2) as a
            from public.shifts where pay_run_id = p_pay_run) t
   where pr.id = p_pay_run;
end $function$
;

CREATE OR REPLACE FUNCTION public.approve_shift(p_shift uuid, p_pay_run uuid)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pr public.pay_runs%rowtype;
  v_s  public.shifts%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status in ('exported','paid') then
    raise exception 'pay run already %', v_pr.status;
  end if;

  select * into v_s from public.shifts where id = p_shift for update;
  if not found then raise exception 'shift not found'; end if;
  if v_s.status = 'approved' then raise exception 'shift already approved'; end if;
  if v_s.status = 'paid' then raise exception 'shift already paid'; end if;
  if v_s.rate_snapshot is null then
    raise exception 'shift has no rate — set a rate before approving';
  end if;
  if not exists (
    select 1 from public.pay_run_shifts v
     where v.id = p_shift
       and v.period_start = v_pr.period_start
       and v.period_end   = v_pr.period_end
  ) then
    raise exception 'shift is not in this pay period';
  end if;

  update public.shifts
     set status = 'approved', pay_run_id = v_pr.id,
         approved_at = now(), approved_by = auth.uid()
   where id = p_shift
  returning * into v_s;

  perform public.pay_run_recompute_totals(v_pr.id);
  return v_s;
end $function$
;

CREATE OR REPLACE FUNCTION public.unapprove_shift(p_shift uuid)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_s   public.shifts%rowtype;
  v_run uuid;
  v_status text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_s from public.shifts where id = p_shift for update;
  if not found then raise exception 'shift not found'; end if;
  if v_s.status <> 'approved' then
    raise exception 'shift is % — only approved shifts can be unapproved', v_s.status;
  end if;

  v_run := v_s.pay_run_id;
  if v_run is not null then
    select status into v_status from public.pay_runs where id = v_run;
    if v_status in ('exported','paid') then
      raise exception 'pay run already % — the shift cannot be pulled back', v_status;
    end if;
  end if;

  update public.shifts
     set status = 'submitted', pay_run_id = null,
         approved_at = null, approved_by = null
   where id = p_shift
  returning * into v_s;

  if v_run is not null then
    perform public.pay_run_recompute_totals(v_run);
  end if;
  return v_s;
end $function$
;

CREATE OR REPLACE FUNCTION public.approve_pay_run(p_pay_run uuid, p_sweep boolean DEFAULT true)
 RETURNS pay_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pr public.pay_runs%rowtype;
  v_hours numeric(10,2);
  v_amount numeric(12,2);
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status in ('exported','paid') then
    raise exception 'pay run already %', v_pr.status;
  end if;

  if p_sweep then
    update public.shifts s
       set status      = 'approved',
           pay_run_id  = v_pr.id,
           approved_at = now(),
           approved_by = auth.uid()
     where s.work_date between v_pr.period_start and v_pr.period_end
       and s.status in ('draft','submitted')
       and s.rate_snapshot is not null;
  elsif not exists (select 1 from public.shifts where pay_run_id = v_pr.id) then
    raise exception 'no approved shifts attached — approve at least one shift first';
  end if;

  select coalesce(sum(hours),0)::numeric(10,2),
         coalesce(sum(hours * coalesce(rate_snapshot,0)),0)::numeric(12,2)
    into v_hours, v_amount
    from public.shifts
   where pay_run_id = v_pr.id;

  update public.pay_runs
     set status       = 'approved',
         approved_at  = now(),
         approved_by  = auth.uid(),
         total_hours  = v_hours,
         total_amount = v_amount
   where id = v_pr.id
  returning * into v_pr;

  return v_pr;
end $function$
;

CREATE OR REPLACE FUNCTION public.mark_pay_run_exported(p_pay_run uuid)
 RETURNS pay_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pr public.pay_runs%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status != 'approved' then
    raise exception 'pay run must be approved before export (current: %)', v_pr.status;
  end if;

  update public.pay_runs
     set status = 'exported',
         exported_at = now()
   where id = p_pay_run
  returning * into v_pr;

  return v_pr;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_lessons_for_class(p_class_id integer, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_class    classes%rowtype;
  v_term     terms%rowtype;
  v_days     text[];
  v_tutor    uuid;
  v_today    date := current_date;
  v_missing  jsonb;
  v_stranded jsonb;
  v_added    integer := 0;
begin
  if not public.is_staff() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: staff only';
  end if;

  select * into v_class from classes where id = p_class_id;
  if not found then raise exception 'Class % not found', p_class_id; end if;
  select * into v_term from terms where id = v_class.term_id;
  if not found then raise exception 'No term linked to class %', p_class_id; end if;
  -- Weeks run Monday–Sunday: a term stored as starting on a Tuesday (NSW
  -- calendar after a long weekend) starts on that week's Monday for us.
  v_term.start_date := date_trunc('week', v_term.start_date)::date;

  select array(select btrim(d) from unnest(string_to_array(v_class.day_of_week, ',')) d
               where btrim(d) <> '') into v_days;
  if array_length(v_days, 1) is null then
    raise exception 'Class % has no day_of_week set', p_class_id;
  end if;

  v_tutor := public.resolve_tutor_by_first_name(v_class.teacher);

  with wanted as (
    select d::date as lesson_date,
           floor((d::date - v_term.start_date)::numeric / 7)::int + 1 as week
    from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
    where (case extract(dow from d)
             when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
             when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
             when 6 then 'Saturday' end) = any (v_days)
  ),
  per_week as (
    select week, count(*)::int as full_wanted from wanted group by week
  ),
  have as (
    select floor((l.lesson_date - v_term.start_date)::numeric / 7)::int + 1 as week,
           count(*)::int as n
    from lessons l
    where l.class_id = p_class_id
      and coalesce(l.is_makeup, false) = false
      and (l.lesson_type is null or l.lesson_type = 'class')
      and l.lesson_date between v_term.start_date and v_term.end_date
    group by 1
  ),
  owed as (
    select p.week, p.full_wanted - coalesce(h.n, 0) as owed
    from per_week p left join have h on h.week = p.week
  ),
  open_dates as (
    select w.lesson_date, w.week,
           row_number() over (partition by w.week order by w.lesson_date) as rn
    from wanted w
    where w.lesson_date >= v_today
      and not exists (
        select 1 from lessons l
        where l.class_id = p_class_id and l.lesson_date = w.lesson_date
          and coalesce(l.is_makeup, false) = false)
  ),
  gaps as (
    select o.lesson_date, o.week
    from open_dates o join owed od on od.week = o.week
    where o.rn <= od.owed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_date', lesson_date, 'week', week,
           'start_time', v_class.start_time, 'end_time', v_class.end_time,
           'room', v_class.room) order by lesson_date), '[]'::jsonb)
    into v_missing from gaps;

  select coalesce(jsonb_agg(jsonb_build_object('lesson_id', l.id, 'lesson_date', l.lesson_date)
                            order by l.lesson_date), '[]'::jsonb)
    into v_stranded
  from lessons l
  where l.class_id = p_class_id and coalesce(l.is_makeup, false) = false
    and (l.lesson_type is null or l.lesson_type = 'class')
    and l.lesson_date >= v_today and l.status <> 'cancelled'
    and not exists (
      select 1 from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
      where d::date = l.lesson_date
        and (case extract(dow from d)
               when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
               when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
               when 6 then 'Saturday' end) = any (v_days));

  if p_apply and jsonb_array_length(v_missing) > 0 then
    with ins as (
      insert into lessons (class_id, lesson_date, start_time, end_time, room,
                           status, week, main_teacher, scheduled_teacher_id, is_makeup)
      select p_class_id, (x->>'lesson_date')::date, v_class.start_time, v_class.end_time,
             v_class.room, 'scheduled', (x->>'week')::int, v_class.teacher, v_tutor, false
      from jsonb_array_elements(v_missing) x
      on conflict (class_id, lesson_date) where (is_makeup = false) do nothing
      returning 1
    )
    select count(*) into v_added from ins;
  end if;

  return jsonb_build_object(
    'class_id', p_class_id, 'class_name', v_class.class_name,
    'applied', p_apply, 'count', jsonb_array_length(v_missing),
    'added', v_added, 'lessons', v_missing, 'stranded', v_stranded);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_lessons_for_class(p_class_id integer, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_class    classes%rowtype;
  v_term     terms%rowtype;
  v_days     text[];
  v_today    date := current_date;
  v_plan     jsonb;
  v_changes  jsonb;
  v_stranded jsonb;
  v_applied  integer := 0;
begin
  if not public.is_staff() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: staff only';
  end if;

  select * into v_class from classes where id = p_class_id;
  if not found then raise exception 'Class % not found', p_class_id; end if;
  select * into v_term from terms where id = v_class.term_id;
  if not found then raise exception 'No term linked to class %', p_class_id; end if;
  -- Weeks run Monday–Sunday: a term stored as starting on a Tuesday (NSW
  -- calendar after a long weekend) starts on that week's Monday for us.
  v_term.start_date := date_trunc('week', v_term.start_date)::date;

  select array(select btrim(d) from unnest(string_to_array(v_class.day_of_week, ',')) d
               where btrim(d) <> '') into v_days;
  if array_length(v_days, 1) is null then
    raise exception 'Class % has no day_of_week set', p_class_id;
  end if;

  with sched as (
    select d::date as lesson_date,
           floor((d::date - v_term.start_date)::numeric / 7)::int + 1 as week
    from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
    where (case extract(dow from d)
             when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
             when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
             when 6 then 'Saturday' end) = any (v_days)
      and d::date >= v_today
  ),
  mine as (
    select l.* from lessons l
    where l.class_id = p_class_id
      and coalesce(l.is_makeup, false) = false
      and (l.lesson_type is null or l.lesson_type = 'class')
      and l.lesson_date >= v_today
      and l.status <> 'cancelled'
      and not exists (select 1 from attendance a
                      where a.class_id = p_class_id and a.session_date = l.lesson_date)
  ),
  on_day as (select * from mine where lesson_date in (select lesson_date from sched)),
  stranded as (
    select m.*, row_number() over (order by m.lesson_date) rn
    from mine m where m.lesson_date not in (select lesson_date from sched)
  ),
  free as (
    select s.*, row_number() over (order by s.lesson_date) rn
    from sched s
    where not exists (select 1 from lessons l
                      where l.class_id = p_class_id and l.lesson_date = s.lesson_date
                        and coalesce(l.is_makeup, false) = false)
  ),
  -- A lesson stranded on a day the class no longer runs is MOVED onto the next
  -- free scheduled date, in order, so the row (and its notes) survives.
  moves as (
    select st.id as lesson_id, st.lesson_date as old_date, f.lesson_date as new_date,
           st.start_time as old_start, st.end_time as old_end, st.room as old_room,
           st.week as old_week, f.week as new_week, true as moved
    from stranded st join free f on f.rn = st.rn
  ),
  retimes as (
    select o.id, o.lesson_date, o.lesson_date,
           o.start_time, o.end_time, o.room, o.week,
           (select week from sched s where s.lesson_date = o.lesson_date), false
    from on_day o
    where o.start_time is distinct from v_class.start_time
       or o.end_time   is distinct from v_class.end_time
       or o.room       is distinct from v_class.room
       or o.week       is distinct from (select week from sched s where s.lesson_date = o.lesson_date)
  ),
  plan as (select * from moves union all select * from retimes)
  select coalesce(jsonb_agg(to_jsonb(plan) order by old_date), '[]'::jsonb)
    into v_plan from plan;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id', (x->>'lesson_id')::int, 'moved', (x->>'moved')::boolean,
           'from_date', x->>'old_date', 'to_date', x->>'new_date',
           'from_time', coalesce(x->>'old_start','')||'-'||coalesce(x->>'old_end',''),
           'to_time',   coalesce(v_class.start_time,'')||'-'||coalesce(v_class.end_time,''),
           'from_room', x->>'old_room', 'to_room', v_class.room,
           'from_week', (x->>'old_week')::int, 'to_week', (x->>'new_week')::int)
           order by x->>'old_date'), '[]'::jsonb)
    into v_changes from jsonb_array_elements(v_plan) x;

  -- Stranded with nowhere free to go: left exactly where they are, reported.
  select coalesce(jsonb_agg(jsonb_build_object('lesson_id', l.id, 'lesson_date', l.lesson_date)
                            order by l.lesson_date), '[]'::jsonb)
    into v_stranded
  from lessons l
  where l.class_id = p_class_id and coalesce(l.is_makeup, false) = false
    and (l.lesson_type is null or l.lesson_type = 'class')
    and l.lesson_date >= v_today and l.status <> 'cancelled'
    and not exists (select 1 from jsonb_array_elements(v_plan) x
                    where (x->>'lesson_id')::int = l.id)
    and not exists (
      select 1 from generate_series(v_term.start_date, v_term.end_date, interval '1 day') d
      where d::date = l.lesson_date
        and (case extract(dow from d)
               when 0 then 'Sunday'    when 1 then 'Monday'   when 2 then 'Tuesday'
               when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
               when 6 then 'Saturday' end) = any (v_days));

  if p_apply and jsonb_array_length(v_plan) > 0 then
    -- Move targets are only ever dates with no lesson on them, so nothing can
    -- collide on (class_id, lesson_date) and the order of updates is free.
    with upd as (
      update lessons l
      set lesson_date = (x->>'new_date')::date,
          start_time  = v_class.start_time,
          end_time    = v_class.end_time,
          room        = v_class.room,
          week        = (x->>'new_week')::int
      from jsonb_array_elements(v_plan) x
      where l.id = (x->>'lesson_id')::int
      returning 1
    )
    select count(*) into v_applied from upd;
  end if;

  return jsonb_build_object(
    'class_id', p_class_id, 'class_name', v_class.class_name,
    'applied', p_apply, 'count', jsonb_array_length(v_changes),
    'updated', v_applied, 'changes', v_changes, 'stranded', v_stranded);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lessons_for_class(p_class_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_class      classes%ROWTYPE;
  v_term       terms%ROWTYPE;
  v_days       text[];
  v_teacher_id uuid;
  v_today      date := current_date;
  v_desired    date[];
  v_inserted   integer := 0;
  v_updated    integer := 0;
  v_deleted    integer := 0;
  v_protected  integer := 0;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden: staff only';
  END IF;

  SELECT * INTO v_class FROM classes WHERE id = p_class_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class % not found', p_class_id; END IF;

  SELECT * INTO v_term FROM terms WHERE id = v_class.term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No term linked to class %', p_class_id; END IF;
  -- Weeks run Monday–Sunday: a term stored as starting on a Tuesday (NSW
  -- calendar after a long weekend) starts on that week's Monday for us.
  v_term.start_date := date_trunc('week', v_term.start_date)::date;

  SELECT ARRAY(
    SELECT TRIM(d)
    FROM unnest(string_to_array(v_class.day_of_week, ',')) AS d
    WHERE TRIM(d) <> ''
  ) INTO v_days;
  IF array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Class % has no day_of_week set', p_class_id;
  END IF;

  v_teacher_id := public.resolve_tutor_by_first_name(v_class.teacher);

  SELECT ARRAY(
    SELECT d::date
    FROM generate_series(v_term.start_date, v_term.end_date, interval '1 day') AS d
    WHERE (CASE EXTRACT(DOW FROM d)
             WHEN 0 THEN 'Sunday'    WHEN 1 THEN 'Monday'   WHEN 2 THEN 'Tuesday'
             WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
             WHEN 6 THEN 'Saturday'
           END) = ANY (v_days)
      AND d::date >= v_today
  ) INTO v_desired;

  WITH ins AS (
    INSERT INTO lessons (
      class_id, lesson_date, start_time, end_time, room, status, week,
      main_teacher, scheduled_teacher_id, is_makeup
    )
    SELECT p_class_id, d,
           v_class.start_time, v_class.end_time, v_class.room, 'scheduled',
           FLOOR((d - v_term.start_date)::numeric / 7)::int + 1,
           v_class.teacher, v_teacher_id, false
    FROM unnest(v_desired) AS d
    ON CONFLICT (class_id, lesson_date) WHERE (is_makeup = false) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH upd AS (
    UPDATE lessons l
    SET start_time = v_class.start_time,
        end_time   = v_class.end_time,
        room       = v_class.room,
        week       = FLOOR((l.lesson_date - v_term.start_date)::numeric / 7)::int + 1
    WHERE l.class_id = p_class_id
      AND l.is_makeup = false
      AND (l.lesson_type IS NULL OR l.lesson_type = 'class')
      AND l.lesson_date >= v_today
      AND l.status <> 'cancelled'
      AND l.lesson_date = ANY (v_desired)
      AND (l.start_time IS DISTINCT FROM v_class.start_time
        OR l.end_time   IS DISTINCT FROM v_class.end_time
        OR l.room       IS DISTINCT FROM v_class.room
        OR l.week       IS DISTINCT FROM FLOOR((l.lesson_date - v_term.start_date)::numeric / 7)::int + 1)
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  IF array_length(v_desired, 1) IS NOT NULL THEN
    WITH del AS (
      DELETE FROM lessons l
      WHERE l.class_id = p_class_id
        AND l.is_makeup = false
        AND (l.lesson_type IS NULL OR l.lesson_type = 'class')
        AND l.lesson_date >= v_today
        AND l.status <> 'cancelled'
        AND NOT (l.lesson_date = ANY (v_desired))
        AND NOT EXISTS (SELECT 1 FROM attendance a
                        WHERE a.class_id = p_class_id AND a.session_date = l.lesson_date)
        AND NOT EXISTS (SELECT 1 FROM lessons m WHERE m.makeup_source_lesson_id = l.id)
        AND l.notes IS NULL AND l.notes_general IS NULL
        AND l.notes_workbook IS NULL AND l.notes_homework IS NULL
        AND COALESCE(l.has_rq, false) = false
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM del;

    SELECT count(*) INTO v_protected
    FROM lessons l
    WHERE l.class_id = p_class_id
      AND l.is_makeup = false
      AND (l.lesson_type IS NULL OR l.lesson_type = 'class')
      AND l.lesson_date >= v_today
      AND NOT (l.lesson_date = ANY (v_desired))
      AND (
        l.status = 'cancelled'
        OR EXISTS (SELECT 1 FROM attendance a
                   WHERE a.class_id = p_class_id AND a.session_date = l.lesson_date)
        OR EXISTS (SELECT 1 FROM lessons m WHERE m.makeup_source_lesson_id = l.id)
        OR l.notes IS NOT NULL OR l.notes_general IS NOT NULL
        OR l.notes_workbook IS NOT NULL OR l.notes_homework IS NOT NULL
        OR COALESCE(l.has_rq, false) = true
      );
  END IF;

  RETURN jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated,
    'deleted', v_deleted, 'protected', v_protected
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.course_year(p_code text, p_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(nullif(substring(coalesce(p_code, '') from '^(\d{1,2})\.'), '')::int,
                  public.parse_class_year(p_name));
$function$
;

CREATE OR REPLACE FUNCTION public.class_year_matches_course()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_class_year  integer := public.parse_class_year(new.class_name);
  v_course      record;
  v_course_year integer;
begin
  -- Only a new class, a rename or a course change is checked.
  if tg_op = 'UPDATE' and new.class_name is not distinct from old.class_name
                      and new.course_id is not distinct from old.course_id then
    return new;
  end if;
  if v_class_year is null or new.course_id is null then return new; end if;

  select course_name, course_code into v_course from public.courses where id = new.course_id;
  if not found then return new; end if;
  v_course_year := public.course_year(v_course.course_code, v_course.course_name);

  if v_course_year is not null and v_course_year <> v_class_year then
    raise exception using
      errcode = 'check_violation',
      message = format('"%s" is Year %s, but its course "%s" (%s) is Year %s.',
                       new.class_name, v_class_year, v_course.course_name, v_course.course_code, v_course_year),
      hint    = format('Choose the Year %s course, or rename the class.', v_class_year);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.course_year_consistent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name_year integer := public.parse_class_year(new.course_name);
  v_code_year integer := nullif(substring(coalesce(new.course_code, '') from '^(\d{1,2})\.'), '')::int;
  v_year      integer := public.course_year(new.course_code, new.course_name);
  v_clash     text;
begin
  if tg_op = 'UPDATE' and new.course_name is not distinct from old.course_name
                      and new.course_code is not distinct from old.course_code then
    return new;
  end if;

  if v_name_year is not null and v_code_year is not null and v_name_year <> v_code_year then
    raise exception using
      errcode = 'check_violation',
      message = format('Course "%s" says Year %s in its name but Year %s in its code (%s).',
                       new.course_name, v_name_year, v_code_year, new.course_code),
      hint    = 'Make the name and the code agree.';
  end if;

  if tg_op = 'UPDATE' and v_year is distinct from public.course_year(old.course_code, old.course_name) then
    select string_agg(format('%s (%s)', c.class_name, c.id), ', ' order by c.id) into v_clash
      from public.classes c
     where c.course_id = new.id
       and public.parse_class_year(c.class_name) is not null
       and public.parse_class_year(c.class_name) is distinct from v_year;
    if v_clash is not null then
      raise exception using
        errcode = 'check_violation',
        message = format('Changing course "%s" to Year %s would leave classes of another year on it: %s.',
                         new.course_name, v_year, v_clash),
        hint    = 'Move or rename those classes first.';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.queue_invoice_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.payroll_match(p_period_start date, p_period_end date, p_today date DEFAULT NULL::date)
 RETURNS TABLE(category text, kind text, shift_id uuid, tutor_id uuid, tutor_name text, work_date date, class_id integer, title text, problems text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_today   date := coalesce(p_today, (now() at time zone 'Australia/Sydney')::date);
  s         record;
  c         record;
  l         record;
  ds        record;
  d         record;
  v_cid     integer;
  v_probs   text[];
  v_tutor   uuid;
  v_start   time;
  v_end     time;
  v_hours   numeric;
  v_rate    numeric;
  v_marked  boolean;
  v_closed  text;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;
  -- A fortnight already exported or paid: anything still waiting in it was
  -- left out of that pay — say so, whatever else is true of the shift.
  select status into v_closed from public.pay_runs
   where period_start = p_period_start and period_end = p_period_end and status in ('exported', 'paid');

  -- ── Shifts waiting for approval in this pay period ───────────────────────
  for s in
    select sh.* from public.shifts sh
    cross join lateral public.pay_period_for(sh.work_date) pp
    where pp.period_start = p_period_start and pp.period_end = p_period_end
      and sh.status in ('draft', 'submitted') and sh.work_date <= v_today
    order by sh.work_date, sh.start_time, sh.id
  loop
    v_probs := '{}';
    v_cid := null;
    v_rate := null;
    title := coalesce(nullif(regexp_replace(coalesce(s.notes, ''), '^Auto: ', ''), ''), 'Shift');

    if s.source_table = 'class_session' and s.source_id ~ '^\d+_' then
      kind := 'class';
      v_cid := split_part(s.source_id, '_', 1)::int;
      select * into c from public.classes where id = v_cid;
      title := coalesce(c.class_name, title);
      select * into l from public.lessons
       where lessons.class_id = v_cid and lesson_date = s.work_date
       order by coalesce(is_makeup, false), id limit 1;
      if l.id is null then
        v_probs := v_probs || 'No lesson was scheduled for this class on this day'::text;
      elsif l.status = 'cancelled' then
        v_probs := v_probs || 'The lesson was cancelled'::text;
      end if;

      v_tutor := coalesce(l.scheduled_teacher_id, public.resolve_tutor_by_first_name(c.teacher));
      if v_tutor is distinct from s.tutor_id then
        v_probs := v_probs || format('The lesson''s teacher is %s',
          coalesce((select full_name from public.tutors where id = v_tutor),
                   (select full_name from public.directors where id = v_tutor), 'not set'));
      end if;

      v_start := coalesce(public.parse_class_time(l.start_time), public.parse_class_time(c.start_time));
      v_end   := coalesce(public.parse_class_time(l.end_time),   public.parse_class_time(c.end_time));
      if v_start is not null and v_end is not null then
        if v_end < v_start then v_end := v_end + interval '12 hours'; end if;
        v_hours := round(extract(epoch from (v_end - v_start)) / 3600.0, 2);
        if v_hours is distinct from s.hours then
          v_probs := v_probs || format('Scheduled for %sh, the shift is %sh', trim_scale(v_hours), trim_scale(s.hours));
        end if;
      else
        v_probs := v_probs || 'The class has no times to check the hours against'::text;
      end if;

      v_rate := public.resolve_matrix_rate(s.tutor_id, c.class_name, s.work_date);

    elsif s.source_table = 'dropin_sessions' then
      kind := 'dropin';
      select * into ds from public.dropin_sessions where id::text = split_part(s.source_id, '_', 1);
      title := 'Drop-in' || coalesce(' @ ' || nullif(ds.location, ''), '');
      if ds.id is null then
        v_probs := v_probs || 'The drop-in session no longer exists'::text;
      else
        if not exists (select 1 from unnest(coalesce(ds.tutors, '{}'::text[])) n
                        where public.resolve_tutor_by_first_name(n) = s.tutor_id) then
          v_probs := v_probs || 'Not rostered on this drop-in'::text;
        end if;
        if s.work_date <> ds.session_date then
          v_probs := v_probs || 'Dated differently from the session'::text;
        end if;
        if s.start_time is null or s.end_time is null
           or s.start_time < ds.start_time or s.end_time > ds.end_time then
          v_probs := v_probs || format('Outside the session''s times (%s–%s)',
            to_char(ds.start_time, 'FMHH12:MIam'), to_char(ds.end_time, 'FMHH12:MIam'));
        elsif round(extract(epoch from (s.end_time - s.start_time)) / 3600.0, 2) is distinct from s.hours then
          v_probs := v_probs || 'The hours don''t match its start and finish'::text;
        end if;
        v_rate := public.dropin_matrix_rate(s.tutor_id, ds.year_groups, ds.session_date);
      end if;

    else
      kind := 'manual';
      v_probs := v_probs || 'Added by hand'::text;
      v_rate := null;
    end if;

    if s.rate_snapshot is null then
      v_probs := v_probs || 'No rate set'::text;
    elsif kind <> 'manual' and v_rate is distinct from s.rate_snapshot then
      v_probs := v_probs || coalesce(format('The rate table says $%s/h', trim_scale(v_rate)), 'The rate table has no rate for this');
    end if;

    -- An admin took it back out of approval: it waits for them, it is not
    -- re-approved behind their back.
    if s.status = 'submitted' then
      v_probs := v_probs || 'Taken out of approval by hand — approve it when it''s right'::text;
    end if;

    if v_closed is not null then
      v_probs := v_probs || format('Left out of this fortnight''s pay run, which is already %s — it still needs paying', v_closed);
    end if;

    category := case when cardinality(v_probs) = 0 then 'match' else 'issue' end;
    shift_id := s.id;
    tutor_id := s.tutor_id;
    tutor_name := coalesce((select full_name from public.tutors where id = s.tutor_id),
                           (select full_name from public.directors where id = s.tutor_id));
    work_date := s.work_date;
    class_id := v_cid;
    problems := v_probs;
    return next;
  end loop;

  -- ── Lessons that should have been paid but have no shift ─────────────────
  -- Up to yesterday: today's classes may simply not have run yet.
  for d in
    select distinct on (l2.class_id, l2.lesson_date)
           l2.class_id as cid, l2.lesson_date, l2.scheduled_teacher_id, l2.start_time, l2.end_time,
           c2.class_name, c2.teacher, c2.start_time as c_start, c2.end_time as c_end
    from public.lessons l2
    join public.classes c2 on c2.id = l2.class_id
    cross join lateral public.pay_period_for(l2.lesson_date) pp
    where pp.period_start = p_period_start and pp.period_end = p_period_end
      and l2.lesson_date < v_today and l2.status <> 'cancelled'
      and coalesce(c2.status, 'active') = 'active'
    order by l2.class_id, l2.lesson_date, coalesce(l2.is_makeup, false), l2.id
  loop
    continue when exists (select 1 from public.shifts x
                           where x.source_table = 'class_session' and x.source_id = d.cid || '_' || d.lesson_date);
    v_marked := exists (select 1 from public.attendance a where a.class_id = d.cid and a.session_date = d.lesson_date);
    -- Marked, and every student cancelled or moved: the lesson didn't run.
    continue when v_marked and not exists (
      select 1 from public.attendance a where a.class_id = d.cid and a.session_date = d.lesson_date
         and a.status not in ('cancelled', 'makeup'));

    v_tutor := coalesce(d.scheduled_teacher_id, public.resolve_tutor_by_first_name(d.teacher));
    v_probs := array[case when v_marked then 'The roll was marked but no shift was created'
                          else 'No shift — the roll hasn''t been marked' end];
    if v_marked and v_tutor is null then
      v_probs := v_probs || format('No staff member matches the teacher "%s"', coalesce(d.teacher, ''));
    end if;
    if v_marked and coalesce(public.parse_class_time(d.start_time), public.parse_class_time(d.c_start)) is null then
      v_probs := v_probs || 'The class has no start or finish time'::text;
    end if;

    category := 'issue';
    kind := 'missing';
    shift_id := null;
    tutor_id := v_tutor;
    tutor_name := coalesce((select full_name from public.tutors where id = v_tutor),
                           (select full_name from public.directors where id = v_tutor), d.teacher);
    work_date := d.lesson_date;
    class_id := d.cid;
    title := d.class_name;
    problems := v_probs;
    return next;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_approve_matched_shifts(p_period_start date, p_period_end date, p_today date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_run public.pay_runs%rowtype;
  n     integer;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;

  insert into public.pay_runs (period_start, period_end, status)
  values (p_period_start, p_period_end, 'open')
  on conflict (period_start, period_end) do nothing;
  select * into v_run from public.pay_runs where period_start = p_period_start and period_end = p_period_end;
  -- An exported or paid run is settled: nothing joins it now.
  if v_run.status in ('exported', 'paid', 'void') then return 0; end if;

  update public.shifts
     set status = 'approved', pay_run_id = v_run.id, approved_at = now(), approved_by = auth.uid()
   where id in (select m.shift_id from public.payroll_match(p_period_start, p_period_end, p_today) m
                 where m.category = 'match')
     and status = 'draft';
  get diagnostics n = row_count;

  if n > 0 then
    update public.pay_runs pr
       set total_hours  = t.h, total_amount = t.a
      from (select coalesce(sum(hours), 0)::numeric(10,2) as h,
                   coalesce(sum(hours * coalesce(rate_snapshot, 0)), 0)::numeric(12,2) as a
              from public.shifts where pay_run_id = v_run.id) t
     where pr.id = v_run.id;
  end if;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_approve_due_shifts(p_today date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Australia/Sydney')::date);
  cur  record;
  prev record;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;
  select * into cur from public.pay_period_for(v_today);
  if cur.period_start is null then return 0; end if;
  select * into prev from public.pay_period_for(cur.period_start - 1);
  return public.auto_approve_matched_shifts(cur.period_start, cur.period_end, v_today)
       + coalesce(case when prev.period_start is not null and prev.period_start <> cur.period_start
                       then public.auto_approve_matched_shifts(prev.period_start, prev.period_end, v_today) end, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trial_submission_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.last_activity_at := coalesce(new.last_activity_at, new.submitted_at, now());
    return new;
  end if;
  if new.status               is distinct from old.status
     or new.admin_notes        is distinct from old.admin_notes
     or new.notes              is distinct from old.notes
     or new.trial_date         is distinct from old.trial_date
     or new.trial_class_id     is distinct from old.trial_class_id
     or new.converted_student_id is distinct from old.converted_student_id
     or new.enrolment_id       is distinct from old.enrolment_id
     or new.contacted_at       is distinct from old.contacted_at
     or new.invitation_sent_at is distinct from old.invitation_sent_at
     or new.level_test_invitation_sent_at is distinct from old.level_test_invitation_sent_at
     or new.reminder_sent_at   is distinct from old.reminder_sent_at
     or new.lesson1_feedback_sent_at is distinct from old.lesson1_feedback_sent_at
     or new.outcome_sent_at    is distinct from old.outcome_sent_at then
    new.last_activity_at := now();
    new.stale_notified_at := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.qbank_subject_key(p_course_code text, p_class_name text)
 RETURNS TABLE(year_level integer, subject_name text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with parts as (
    select nullif(split_part(coalesce(p_course_code, ''), '.', 1), '') as y,
           upper(split_part(coalesce(p_course_code, ''), '.', 2)) as sfx,
           lower(coalesce(p_class_name, '')) as nm
  ), yr as (
    select case when y ~ '^\d+$' then y::int
                else nullif((regexp_match(nm, 'y(?:ear)?\s*(\d{1,2})'))[1], '')::int end as year_level,
           sfx, nm
    from parts
  ), by_code as (
    select year_level, nm,
      case
        when year_level >= 11 and sfx like 'M1%' then 'Standard Maths'
        when year_level >= 11 and sfx like 'M2%' then 'Adv Maths'
        when year_level >= 11 and sfx like 'M3%' then 'Ext 1 Maths'
        when year_level >= 11 and sfx like 'M4%' then 'Ext 2 Maths'
        when sfx like 'M%' then 'Maths'
        when sfx like 'E%' then 'English'
        when sfx like 'C%' then 'Chemistry'
        when sfx like 'P%' then 'Physics'
        when sfx like 'S%' then 'Science'
        else null
      end as subject_name
    from yr
  )
  select distinct year_level, subject_name from (
    select year_level, subject_name from by_code
    union all
    select year_level, 'Ext 1 Maths' from by_code where nm like '%ext 1%' or nm like '%extension 1%'
    union all
    select year_level, 'Ext 2 Maths' from by_code where nm like '%ext 2%' or nm like '%extension 2%'
    union all
    select year_level,
      case
        when nm like '%standard%' then 'Standard Maths'
        when nm like '%adv%' then 'Adv Maths'
        when nm like '%chem%' then 'Chemistry'
        when nm like '%physics%' then 'Physics'
        when nm like '%english%' or nm like '%eald%' then 'English'
        when nm like '%science%' then 'Science'
        when nm like '%math%' then case when year_level >= 11 then 'Adv Maths' else 'Maths' end
        else null
      end
    from by_code where subject_name is null
  ) k
  where year_level is not null and subject_name is not null
$function$
;

CREATE OR REPLACE FUNCTION public.student_qbank_subject_ids(p_student uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with direct as (
    select distinct s.id
    from public.enrolments e
    join public.classes c on c.id = e.class_id
    left join public.courses co on co.id = c.course_id
    cross join lateral public.qbank_subject_key(co.course_code, c.class_name) k
    join public.qbank_subjects s on s.year_level = k.year_level and lower(s.name) = lower(k.subject_name)
    where e.student_id = p_student
      and e.status in ('active', 'trial') and e.ended_at is null
  )
  select id from direct
  union
  -- A linked subject comes with it (Year 11 Ext 1 → Year 11 Adv).
  select l.shows_subject_id from public.qbank_subject_links l join direct d on d.id = l.subject_id
$function$
;

CREATE OR REPLACE FUNCTION public.qbank_question_open_to_student(p_question uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.qbank_questions q
    left join public.qbank_skills sk on sk.id = q.skill_id
    join public.qbank_topics t on t.id = coalesce(q.topic_id, sk.topic_id)
    where q.id = p_question
      and coalesce(q.audience, 'student') <> 'exam'
      and t.subject_id in (select public.student_qbank_subject_ids(auth.uid()))
  )
$function$
;

CREATE OR REPLACE FUNCTION public.drop_draft_class_shift(p_class integer, p_date date)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  delete from public.shifts
   where source_table = 'class_session'
     and source_id = p_class::text || '_' || p_date::text
     and status = 'draft'
$function$
;

CREATE OR REPLACE FUNCTION public.lesson_cancelled_drops_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and not coalesce(new.is_makeup, false) then
    perform public.drop_draft_class_shift(new.class_id, new.lesson_date);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.derived_student_status(p_student uuid, p_today date DEFAULT ((now() AT TIME ZONE 'Australia/Sydney'::text))::date)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with anchor as (
    select max(start_date) as a from terms where term_number <= 10 and start_date <= p_today
  ),
  live as (
    select e.status
      from enrolments e
      left join classes c on c.id = e.class_id
      left join terms t on t.id = c.term_id
      cross join anchor
     where e.student_id = p_student
       and (e.status <> 'disenrol' or e.ended_at >= p_today)
       and ((t.id is not null and t.end_date >= coalesce(anchor.a, '-infinity'::date))
            or (e.class_id is null and e.status in ('trial', 'trial complete')))
  )
  select case
    when exists (select 1 from live where status in ('active', 'disenrol')) then 'active'
    when exists (select 1 from live where status in ('trial', 'trial complete')) then 'trial'
    when exists (select 1 from enrolments where student_id = p_student) then 'inactive'
    else 'pending'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.students_status_derived()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.status := derived_student_status(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enrolment_refreshes_student_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update students s set status = derived_student_status(s.id)
   where s.id in (case when tg_op <> 'INSERT' then old.student_id end,
                  case when tg_op <> 'DELETE' then new.student_id end)
     and s.status is distinct from derived_student_status(s.id);
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_student_statuses()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  update students s set status = derived_student_status(s.id)
   where s.status is distinct from derived_student_status(s.id);
  get diagnostics n = row_count;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_staff_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.tutors where coalesce(active, true) and not system
  union select id from public.directors
$function$
;

CREATE OR REPLACE FUNCTION public.chat_is_member(p_channel uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.chat_members m join public.chat_channels c on c.id = m.channel_id
    where m.channel_id = p_channel and m.user_id = auth.uid()
      and (c.audience <> 'students' or c.student_visible
           or exists (select 1 from public.chat_staff_ids() s where s = auth.uid())))
$function$
;

CREATE OR REPLACE FUNCTION public.chat_channel_open(p_channel uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.chat_channels c where c.id = p_channel and c.kind = 'channel' and c.audience = 'staff')
$function$
;

CREATE OR REPLACE FUNCTION public.chat_is_director()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.directors d where d.id = auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.is_high_school_student(p_student uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((select s.year ~ '^\d{1,2}$' and s.year::int between 7 and 12
                     from public.students s where s.id = p_student), false)
$function$
;

CREATE OR REPLACE FUNCTION public.chat_can_post(p_channel uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.chat_is_member(p_channel) and not exists (
    select 1 from public.chat_channels c
    where c.id = p_channel and (
      c.archived_at is not null
      or (c.directors_only and not exists (select 1 from public.directors d where d.id = auth.uid()))
      or (c.audience = 'students' and c.kind = 'channel' and not c.student_replies
          and not exists (select 1 from public.chat_staff_ids() s where s = auth.uid()))))
$function$
;

CREATE OR REPLACE FUNCTION public.chat_can_manage(p_channel uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel and c.kind = 'channel'
      and (c.created_by = auth.uid() or exists (select 1 from public.directors d where d.id = auth.uid())))
$function$
;

CREATE OR REPLACE FUNCTION public.chat_today()
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$ select (now() at time zone 'Australia/Sydney')::date $function$
;

CREATE OR REPLACE FUNCTION public.chat_current_term()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with teaching as (select id, start_date, end_date from public.terms where coalesce(term_number, 0) <= 10)
  select coalesce(
    (select id from teaching where public.chat_today() between start_date and end_date order by start_date desc limit 1),
    (select id from teaching where start_date > public.chat_today() order by start_date limit 1))
$function$
;

CREATE OR REPLACE FUNCTION public.chat_open_student_dm(p_student uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_key text; v_id uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  if not exists (select 1 from public.students s where s.id = p_student) then raise exception 'not a student'; end if;
  if not public.is_high_school_student(p_student) then
    raise exception 'Student messaging is for high school students (Years 7–12) only';
  end if;
  v_key := 'student:' || p_student::text;
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by, audience) values ('dm', '', v_key, auth.uid(), 'students') returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, p_student);
  end if;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_open_my_thread()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_key text; v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.students s where s.id = auth.uid() and s.status in ('active', 'trial')) then
    raise exception 'Students only';
  end if;
  if not public.is_high_school_student(auth.uid()) then
    raise exception 'Messaging is for high school students (Years 7–12)';
  end if;
  v_key := 'student:' || auth.uid()::text;
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by, audience)
      values ('dm', '', v_key, auth.uid(), 'students') returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, auth.uid());
  end if;
  insert into public.chat_members (channel_id, user_id) select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_class_members_sync(p_channel uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_class integer; v_teacher uuid;
begin
  select class_id into v_class from public.chat_channels where id = p_channel and audience = 'students';
  if v_class is null then return; end if;
  select public.resolve_tutor_by_first_name(c.teacher) into v_teacher from public.classes c where c.id = v_class;
  insert into public.chat_members (channel_id, user_id)
    select p_channel, e.student_id from public.enrolments e
    where e.class_id = v_class and e.status in ('active', 'trial') and e.ended_at is null
      and e.student_id is not null and public.is_high_school_student(e.student_id)
  on conflict do nothing;
  delete from public.chat_members m
    where m.channel_id = p_channel
      and not exists (select 1 from public.chat_staff_ids() s where s = m.user_id)
      and not exists (select 1 from public.enrolments e
        where e.class_id = v_class and e.student_id = m.user_id and e.status in ('active', 'trial')
          and e.ended_at is null and public.is_high_school_student(e.student_id));
  if v_teacher is not null then
    insert into public.chat_members (channel_id, user_id) values (p_channel, v_teacher) on conflict do nothing;
  end if;
  insert into public.chat_members (channel_id, user_id) select p_channel, d.id from public.directors d on conflict do nothing;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_class_channel(p_class integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_name text; v_year integer;
begin
  if not public.is_admin(auth.uid()) then raise exception 'directors only'; end if;
  select c.class_name, public.course_year(co.course_code, c.class_name) into v_name, v_year
    from public.classes c left join public.courses co on co.id = c.course_id where c.id = p_class;
  if v_name is null then raise exception 'no such class'; end if;
  if v_year is null or v_year < 7 then
    raise exception 'Class channels are for high school classes (Years 7–12) only';
  end if;
  select id into v_id from public.chat_channels where class_id = p_class;
  if v_id is null then
    insert into public.chat_channels (kind, name, created_by, audience, class_id)
      values ('channel', v_name, auth.uid(), 'students', p_class) returning id into v_id;
  end if;
  update public.chat_channels set archived_at = null where id = v_id and archived_at is not null;
  perform public.chat_class_members_sync(v_id);
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_member_names()
 RETURNS TABLE(user_id uuid, display_name text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select exists (select 1 from public.chat_staff_ids() s where s = auth.uid()) as staff),
  mine as (
    select distinct m2.user_id
    from public.chat_members m
    join public.chat_channels c on c.id = m.channel_id
    join public.chat_members m2 on m2.channel_id = m.channel_id
    where m.user_id = auth.uid()
      and (c.audience <> 'students' or c.student_visible or (select staff from me))
  )
  select d.id, case when (select staff from me) then d.full_name else 'CUBE' end, 'director'
    from public.directors d join mine on mine.user_id = d.id
  union all
  select t.id, case when (select staff from me) then t.full_name else split_part(t.full_name, ' ', 1) end, 'tutor'
    from public.tutors t join mine on mine.user_id = t.id
  union all
  select s.id, case when (select staff from me) then s.full_name else split_part(s.full_name, ' ', 1) end, 'student'
    from public.students s join mine on mine.user_id = s.id
$function$
;

CREATE OR REPLACE FUNCTION public.chat_students_persona()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_audience text; v_class integer; v_teacher uuid; v_sender uuid; v_name text; v_m text[];
begin
  v_sender := coalesce(new.sender_id, auth.uid());
  if v_sender is null then return new; end if;
  select audience, class_id into v_audience, v_class from public.chat_channels where id = new.channel_id;

  if not exists (select 1 from public.chat_staff_ids() s where s = v_sender) then
    select full_name into v_name from public.students where id = v_sender;
    new.sender_name := coalesce(nullif(trim(v_name), ''), 'Student');
    new.as_cube := false;
    if length(new.body) > 4000 then
      raise exception 'Messages are limited to 4000 characters';
    end if;
    if tg_table_name = 'chat_messages' and (
      select count(*) from public.chat_messages m
      where m.sender_id = v_sender and m.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'Too many messages in a minute — wait a moment';
    end if;
    for v_m in select regexp_matches(new.body, '\[\[(?:img|file):([^\]|]+)', 'g') loop
      if v_m[1] !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/(chat-uploads|qbank-images)/' then
        raise exception 'Attachments must be uploaded through the chat';
      end if;
    end loop;
    return new;
  end if;

  if not exists (select 1 from public.directors d where d.id = v_sender) then return new; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_messages_keep_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.channel_id := old.channel_id; new.sender_id := old.sender_id;
  new.created_at := old.created_at; new.as_cube := old.as_cube; new.sender_name := old.sender_name;
  if old.deleted_at is not null then new.deleted_at := old.deleted_at; new.body := old.body; return new; end if;
  if new.body is distinct from old.body and coalesce(old.body, '') <> ''
     and exists (select 1 from public.chat_channels c where c.id = old.channel_id and c.audience = 'students') then
    insert into public.chat_message_history (message_id, channel_id, body, action, changed_by)
      values (old.id, old.channel_id, old.body, case when new.deleted_at is not null then 'deleted' else 'edited' end, auth.uid());
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_report_message(p_message uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_channel uuid; v_body text; v_audience text; v_id uuid;
begin
  select m.channel_id, m.body, c.audience into v_channel, v_body, v_audience
    from public.chat_messages m join public.chat_channels c on c.id = m.channel_id where m.id = p_message;
  if v_channel is null or not public.chat_is_member(v_channel) then raise exception 'You can only report messages in your own conversations'; end if;
  if v_audience <> 'students' then raise exception 'Reporting is for student conversations'; end if;
  insert into public.chat_reports (message_id, channel_id, reported_by, reason, body_snapshot)
    values (p_message, v_channel, auth.uid(), nullif(left(trim(coalesce(p_reason, '')), 500), ''), v_body)
  on conflict (message_id, reported_by) do update set reason = excluded.reason, resolved_at = null, resolved_by = null, created_at = now()
  returning id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_resolve_report(p_report uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'directors only'; end if;
  update public.chat_reports set resolved_at = now(), resolved_by = auth.uid() where id = p_report and resolved_at is null;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_set_student_replies(p_channel uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'Only a director can change who may reply'; end if;
  update public.chat_channels set student_replies = p_on where id = p_channel and audience = 'students' and kind = 'channel';
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_hide_message(p_message uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'directors only'; end if;
  update public.chat_messages m set deleted_at = now(), body = ''
    from public.chat_channels c
   where m.id = p_message and c.id = m.channel_id and c.audience = 'students' and m.deleted_at is null;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_unread_counts()
 RETURNS TABLE(channel_id uuid, n bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.channel_id, count(msg.id)
  from public.chat_members m
  join public.chat_channels c on c.id = m.channel_id
  left join public.chat_reads r on r.channel_id = m.channel_id and r.user_id = auth.uid()
  left join public.chat_messages msg on msg.channel_id = m.channel_id
    and msg.sender_id <> auth.uid() and msg.deleted_at is null
    and msg.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  where m.user_id = auth.uid()
    and (c.audience <> 'students' or c.student_visible or exists (select 1 from public.chat_staff_ids() s where s = auth.uid()))
  group by m.channel_id
$function$
;

CREATE OR REPLACE FUNCTION public.chat_create_channel(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  insert into public.chat_channels (kind, name, created_by) values ('channel', trim(p_name), auth.uid()) returning id into v_id;
  insert into public.chat_members (channel_id, user_id)
    select v_id, x.id from (select auth.uid() as id union select id from public.directors) x on conflict do nothing;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_open_dm(p_other uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_key text; v_id uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_other = auth.uid() then raise exception 'that is you'; end if;
  if not exists (select 1 from public.chat_staff_ids() s where s = p_other) then raise exception 'not a staff member'; end if;
  v_key := least(auth.uid()::text, p_other::text) || ':' || greatest(auth.uid()::text, p_other::text);
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by) values ('dm', '', v_key, auth.uid()) returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, auth.uid()), (v_id, p_other);
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_set_student_visible(p_channel uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'Only a director can open a channel to students'; end if;
  update public.chat_channels set student_visible = p_on where id = p_channel and audience = 'students' and kind = 'channel';
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_student_login(p_student uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_status text;
begin
  select status into v_status from public.students where id = p_student;
  if v_status in ('active', 'trial') then
    update auth.users set banned_until = null
     where id = p_student and banned_until is not null
       and coalesce(raw_app_meta_data ->> 'role', 'student') = 'student';
  else
    update auth.users set banned_until = '2999-01-01'::timestamptz
     where id = p_student and (banned_until is null or banned_until < '2999-01-01'::timestamptz)
       and coalesce(raw_app_meta_data ->> 'role', 'student') = 'student';
    if found then
      delete from auth.sessions where user_id = p_student;
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_status_syncs_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform sync_student_login(new.id);
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_members_fixed_keys()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.channel_id is distinct from old.channel_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership cannot be moved to another channel or person — leave and join instead';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trial_enrolment_touches_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update trial_submissions ts
     set last_activity_at = now(), stale_notified_at = null
   where ts.converted_student_id = new.student_id
     and ts.status in ('new', 'contacted', 'trial_scheduled', 'trial_1_completed', 'trial_completed')
     and (ts.enrolment_id = new.id
          or (ts.enrolment_id is null and ts.trial_class_id is not distinct from coalesce(old.class_id, new.class_id)));
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_enrolment_to_trial_submission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  mapped_status text;
begin
  mapped_status := case new.status
    when 'active'         then 'enrolled'
    when 'disenrol'       then 'declined'
    when 'trial complete' then 'trial_completed'
    when 'trial'          then 'trial_scheduled'
    else null
  end;

  if mapped_status is null then return new; end if;
  if mapped_status = 'declined' and new.end_reason = 'Trial on hold' then return new; end if;

  update trial_submissions ts
     set status = mapped_status
   where ts.converted_student_id = new.student_id
     and (
       ts.enrolment_id = new.id
       or (ts.enrolment_id is null and (
             ts.trial_class_id is not distinct from new.class_id
             or (select count(*) from trial_submissions x where x.converted_student_id = new.student_id) = 1))
     );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_trial_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status = 'trial'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (
       select 1 from trial_submissions ts
        where ts.enrolment_id = new.id
           or (ts.converted_student_id = new.student_id and ts.enrolment_id is null
               and ts.status not in ('enrolled', 'declined'))
     )
  then
    insert into trial_submissions
      (submitted_at, student_name, student_year, subjects, status, source,
       trial_class_id, converted_student_id, enrolment_id, admin_notes,
       parent_name, parent_email, parent_phone, relationship, school, how_heard)
    select now(), s.full_name, s.year,
           case when c.class_name is not null then array[regexp_replace(c.class_name, '^Y[0-9]+\s+', '')] end,
           case when new.class_id is null then 'new' else 'trial_scheduled' end,
           'manual', new.class_id, new.student_id, new.id,
           'Auto-created: trial enrolment added outside the pipeline',
           coalesce(prev.parent_name, g.full_name), coalesce(prev.parent_email, g.email),
           coalesce(prev.parent_phone, g.phone), prev.relationship, coalesce(prev.school, s.school), prev.how_heard
      from students s
      left join classes c on c.id = new.class_id
      left join lateral (
        select * from trial_submissions p where p.converted_student_id = s.id
         order by (p.parent_email is not null) desc, p.submitted_at desc limit 1
      ) prev on true
      left join lateral (
        select * from guardians gg where gg.student_id = s.id
         order by (gg.email is not null) desc limit 1
      ) g on true
     where s.id = new.student_id;
  end if;
  return new;
end $function$
;

create view public.pay_run_shifts as
 SELECT s.id,
    s.tutor_id,
    t.full_name AS tutor_name,
    s.work_date,
    s.start_time,
    s.end_time,
    s.hours,
    s.rate_snapshot,
    (s.hours * COALESCE(s.rate_snapshot, 0::numeric))::numeric(10,2) AS amount,
    s.kind,
    s.notes,
    s.status,
    s.pay_run_id,
    s.source_table,
    s.source_id,
    pp.period_start,
    pp.period_end
   FROM shifts s
     JOIN ( SELECT tutors.id,
            tutors.full_name
           FROM tutors
        UNION ALL
         SELECT directors.id,
            directors.full_name
           FROM directors) t ON t.id = s.tutor_id
     CROSS JOIN LATERAL pay_period_for(s.work_date) pp(period_start, period_end, fortnight_index, term_id);

alter table public.terms enable row level security;
alter table public.tutors enable row level security;
alter table public.directors enable row level security;
alter table public.courses enable row level security;
alter table public.classes enable row level security;
alter table public.enrolments enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.dropin_sessions enable row level security;
alter table public.tutor_rate_matrix enable row level security;
alter table public.pay_runs enable row level security;
alter table public.shifts enable row level security;
alter table public.invoice_sync_queue enable row level security;
alter table public.cash_log enable row level security;
alter table public.director_balances enable row level security;
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.invoices enable row level security;
alter table public.student_credits enable row level security;
alter table public.fixed_costs enable row level security;
alter table public.cash_pay_status enable row level security;
alter table public.portal_settings enable row level security;
alter table public.qbank_questions enable row level security;
alter table public.qbank_question_parts enable row level security;
alter table public.qbank_question_images enable row level security;
alter table public.online_resources enable row level security;
alter table public.stimulus_texts enable row level security;
alter table public.job_runs enable row level security;
alter table public.trial_submissions enable row level security;
alter table public.qbank_subjects enable row level security;
alter table public.practice_ratings enable row level security;
alter table public.qbank_topics enable row level security;
alter table public.qbank_skills enable row level security;
alter table public.qbank_subtopics enable row level security;
alter table public.qbank_question_subtopics enable row level security;
alter table public.qbank_subject_links enable row level security;
alter table public.level_test_invites enable row level security;
alter table public.auto_reminders enable row level security;
alter table public.trial_invites enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_scheduled_messages enable row level security;
alter table public.chat_reports enable row level security;
alter table public.chat_message_history enable row level security;
alter table public.lesson_prep enable row level security;
alter table public.chat_stars enable row level security;
create policy "Admin delete attendance" on public.attendance as PERMISSIVE for DELETE to authenticated using (is_admin(auth.uid()));
create policy "Staff insert attendance" on public.attendance as PERMISSIVE for INSERT to public with check (is_staff());
create policy "Staff read all attendance" on public.attendance as PERMISSIVE for SELECT to public using (is_staff());
create policy "Staff update attendance" on public.attendance as PERMISSIVE for UPDATE to public using (is_staff()) with check (is_staff());
create policy "Students see own attendance" on public.attendance as PERMISSIVE for SELECT to public using ((auth.uid() = student_id));
create policy authenticated_full_access on public.attendance as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy auto_reminders_admin_read on public.auto_reminders as PERMISSIVE for SELECT to public using (is_admin(auth.uid()));
create policy cash_log_admin_all on public.cash_log as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy cash_pay_status_admin_all on public.cash_pay_status as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy chat_channels_read on public.chat_channels as PERMISSIVE for SELECT to authenticated using ((((audience = 'staff'::text) AND is_staff() AND ((kind = 'channel'::text) OR chat_is_member(id))) OR ((audience = 'students'::text) AND is_admin(auth.uid())) OR ((audience = 'students'::text) AND chat_is_member(id))));
create policy chat_members_join on public.chat_members as PERMISSIVE for INSERT to authenticated with check ((is_staff() AND (user_id = auth.uid()) AND chat_channel_open(channel_id)));
create policy chat_members_leave on public.chat_members as PERMISSIVE for DELETE to authenticated using (((user_id = auth.uid()) AND (NOT (EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = chat_members.channel_id) AND (c.is_default OR (c.audience = 'students'::text))))))));
create policy chat_members_mute on public.chat_members as PERMISSIVE for UPDATE to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy chat_members_read on public.chat_members as PERMISSIVE for SELECT to authenticated using ((chat_is_member(channel_id) OR (is_staff() AND chat_channel_open(channel_id))));
create policy chat_message_history_directors on public.chat_message_history as PERMISSIVE for SELECT to authenticated using (is_admin(auth.uid()));
create policy chat_messages_own on public.chat_messages as PERMISSIVE for UPDATE to authenticated using ((sender_id = auth.uid())) with check ((sender_id = auth.uid()));
create policy chat_messages_read on public.chat_messages as PERMISSIVE for SELECT to authenticated using (chat_is_member(channel_id));
create policy chat_messages_send on public.chat_messages as PERMISSIVE for INSERT to authenticated with check (((sender_id = auth.uid()) AND chat_can_post(channel_id) AND ((NOT as_cube) OR (EXISTS ( SELECT 1
   FROM directors d
  WHERE (d.id = auth.uid()))))));
create policy chat_reactions_own on public.chat_reactions as PERMISSIVE for ALL to authenticated using ((user_id = auth.uid())) with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM chat_messages m
  WHERE ((m.id = chat_reactions.message_id) AND chat_is_member(m.channel_id))))));
create policy chat_reactions_read on public.chat_reactions as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM chat_messages m
  WHERE ((m.id = chat_reactions.message_id) AND chat_is_member(m.channel_id)))));
create policy chat_reads_own on public.chat_reads as PERMISSIVE for ALL to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy chat_reads_read on public.chat_reads as PERMISSIVE for SELECT to authenticated using (chat_is_member(channel_id));
create policy chat_reports_read on public.chat_reports as PERMISSIVE for SELECT to authenticated using ((is_admin(auth.uid()) OR (reported_by = auth.uid())));
create policy chat_scheduled_delete on public.chat_scheduled_messages as PERMISSIVE for DELETE to authenticated using ((((sender_id = auth.uid()) OR (as_cube AND chat_is_director())) AND (sent_message_id IS NULL)));
create policy chat_scheduled_insert on public.chat_scheduled_messages as PERMISSIVE for INSERT to authenticated with check (((sender_id = auth.uid()) AND (send_at > now()) AND (sent_at IS NULL) AND chat_can_post(channel_id) AND ((NOT as_cube) OR (EXISTS ( SELECT 1
   FROM directors d
  WHERE (d.id = auth.uid()))))));
create policy chat_scheduled_read on public.chat_scheduled_messages as PERMISSIVE for SELECT to authenticated using (((sender_id = auth.uid()) OR (as_cube AND chat_is_director() AND chat_is_member(channel_id))));
create policy chat_scheduled_update on public.chat_scheduled_messages as PERMISSIVE for UPDATE to authenticated using ((((sender_id = auth.uid()) OR (as_cube AND chat_is_director())) AND (sent_at IS NULL))) with check ((((sender_id = auth.uid()) OR (as_cube AND chat_is_director())) AND (sent_at IS NULL) AND chat_can_post(channel_id) AND ((NOT as_cube) OR chat_is_director())));
create policy chat_stars_own_add on public.chat_stars as PERMISSIVE for INSERT to authenticated with check ((user_id = auth.uid()));
create policy chat_stars_own_read on public.chat_stars as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));
create policy chat_stars_own_remove on public.chat_stars as PERMISSIVE for DELETE to authenticated using ((user_id = auth.uid()));
create policy "Admin write classes" on public.classes as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Students can view classes" on public.classes as PERMISSIVE for SELECT to public using (true);
create policy authenticated_full_access on public.classes as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy courses_public_read on public.courses as PERMISSIVE for SELECT to anon using (true);
create policy courses_read_authenticated on public.courses as PERMISSIVE for SELECT to authenticated using (true);
create policy courses_write_admin on public.courses as PERMISSIVE for ALL to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'director'::text]))) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'director'::text])));
create policy director_balances_admin_all on public.director_balances as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy directors_admin_all on public.directors as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy directors_staff_read on public.directors as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "Admin write dropin_sessions" on public.dropin_sessions as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Anyone can read dropin sessions" on public.dropin_sessions as PERMISSIVE for SELECT to public using (true);
create policy authenticated_full_access on public.dropin_sessions as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "Staff read all student_classes" on public.enrolments as PERMISSIVE for SELECT to public using (is_staff());
create policy "Students can view their own class links" on public.enrolments as PERMISSIVE for SELECT to public using ((auth.uid() = student_id));
create policy enrolments_admin_all on public.enrolments as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy fixed_costs_admin_all on public.fixed_costs as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy guardians_admin_all on public.guardians as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy guardians_staff_read on public.guardians as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy invoices_admin_all on public.invoices as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy job_runs_admin_read on public.job_runs as PERMISSIVE for SELECT to authenticated using (is_admin(auth.uid()));
create policy lesson_prep_admin on public.lesson_prep as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy authenticated_full_access on public.lessons as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy lessons_student_read on public.lessons as PERMISSIVE for SELECT to authenticated using (((makeup_student_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM enrolments e
  WHERE ((e.class_id = lessons.class_id) AND (e.student_id = auth.uid()))))));
create policy lessons_write_admin on public.lessons as PERMISSIVE for ALL to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'director'::text]))) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'director'::text])));
create policy admin_all on public.level_test_invites as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy staff_all on public.online_resources as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy pay_runs_admin_all on public.pay_runs as PERMISSIVE for ALL to public using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy portal_settings_admin_all on public.portal_settings as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy portal_settings_staff_own_keys on public.portal_settings as PERMISSIVE for ALL to authenticated using ((is_staff() AND (key = ANY (ARRAY[('chat_pins:'::text || auth.uid()), 'level_test_email_template'::text, 'level_test_family_email_template'::text])))) with check ((is_staff() AND (key = ANY (ARRAY[('chat_pins:'::text || auth.uid()), 'level_test_email_template'::text, 'level_test_family_email_template'::text]))));
create policy practice_ratings_own_delete on public.practice_ratings as PERMISSIVE for DELETE to authenticated using ((student_id = auth.uid()));
create policy practice_ratings_own_insert on public.practice_ratings as PERMISSIVE for INSERT to authenticated with check (((student_id = auth.uid()) AND qbank_question_open_to_student(question_id)));
create policy practice_ratings_own_read on public.practice_ratings as PERMISSIVE for SELECT to authenticated using ((student_id = auth.uid()));
create policy qbank_question_images_read on public.qbank_question_images as PERMISSIVE for SELECT to authenticated using ((is_staff() OR qbank_question_open_to_student(question_id)));
create policy staff_all on public.qbank_question_images as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy qbank_question_parts_read on public.qbank_question_parts as PERMISSIVE for SELECT to authenticated using ((is_staff() OR qbank_question_open_to_student(question_id)));
create policy staff_all on public.qbank_question_parts as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy staff_all on public.qbank_question_subtopics as PERMISSIVE for ALL to public using (is_staff()) with check (is_staff());
create policy students_read_practice_tags on public.qbank_question_subtopics as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM qbank_questions q
  WHERE (q.id = qbank_question_subtopics.question_id))));
create policy qbank_questions_read on public.qbank_questions as PERMISSIVE for SELECT to authenticated using ((is_staff() OR qbank_question_open_to_student(id)));
create policy staff_all on public.qbank_questions as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy read_authenticated on public.qbank_skills as PERMISSIVE for SELECT to authenticated using (true);
create policy staff_all on public.qbank_skills as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy admin_write on public.qbank_subject_links as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy read_authenticated on public.qbank_subject_links as PERMISSIVE for SELECT to authenticated using (true);
create policy read_authenticated on public.qbank_subjects as PERMISSIVE for SELECT to authenticated using (true);
create policy staff_all on public.qbank_subjects as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy read_authenticated on public.qbank_subtopics as PERMISSIVE for SELECT to authenticated using (true);
create policy staff_all on public.qbank_subtopics as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy read_authenticated on public.qbank_topics as PERMISSIVE for SELECT to authenticated using (true);
create policy staff_all on public.qbank_topics as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy shifts_admin_all on public.shifts as PERMISSIVE for ALL to public using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy shifts_tutor_select on public.shifts as PERMISSIVE for SELECT to public using ((tutor_id = auth.uid()));
create policy staff_all on public.stimulus_texts as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "Students read own credits" on public.student_credits as PERMISSIVE for SELECT to authenticated using ((auth.uid() = student_id));
create policy student_credits_admin_all on public.student_credits as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Admin write students" on public.students as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Staff read all students" on public.students as PERMISSIVE for SELECT to public using (is_staff());
create policy "Students see own profile" on public.students as PERMISSIVE for SELECT to public using ((auth.uid() = id));
create policy "Admin write terms" on public.terms as PERMISSIVE for ALL to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Anyone can read terms" on public.terms as PERMISSIVE for SELECT to public using (true);
create policy authenticated_full_access on public.terms as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy terms_read_authenticated on public.terms as PERMISSIVE for SELECT to authenticated using (true);
create policy trial_invites_admin on public.trial_invites as PERMISSIVE for ALL to public using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy staff_all on public.trial_submissions as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy trm_admin_all on public.tutor_rate_matrix as PERMISSIVE for ALL to public using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy trm_tutor_select on public.tutor_rate_matrix as PERMISSIVE for SELECT to public using ((tutor_id = auth.uid()));
create policy authenticated_full_access on public.tutors as PERMISSIVE for ALL to authenticated using ((is_staff() AND ((NOT system) OR (id = auth.uid())))) with check ((is_staff() AND ((NOT system) OR (id = auth.uid()))));

CREATE TRIGGER lessons_sync_main_teacher BEFORE INSERT OR UPDATE OF class_id, main_teacher ON public.lessons FOR EACH ROW EXECUTE FUNCTION sync_lesson_main_teacher();
CREATE TRIGGER attendance_to_shift AFTER INSERT OR UPDATE OF status ON public.attendance FOR EACH ROW EXECUTE FUNCTION create_shift_from_class_attendance();
CREATE TRIGGER dropin_to_shift AFTER INSERT OR UPDATE ON public.dropin_sessions FOR EACH ROW EXECUTE FUNCTION create_shifts_from_dropin();
CREATE TRIGGER shifts_touch BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER classes_year_matches_course BEFORE INSERT OR UPDATE OF class_name, course_id ON public.classes FOR EACH ROW EXECUTE FUNCTION class_year_matches_course();
CREATE TRIGGER courses_year_consistent BEFORE INSERT OR UPDATE OF course_name, course_code ON public.courses FOR EACH ROW EXECUTE FUNCTION course_year_consistent();
CREATE TRIGGER enrolments_queue_invoice_sync AFTER INSERT OR DELETE OR UPDATE OF status, price, class_id, student_id ON public.enrolments FOR EACH ROW EXECUTE FUNCTION queue_invoice_sync();
CREATE TRIGGER trial_submissions_activity BEFORE INSERT OR UPDATE ON public.trial_submissions FOR EACH ROW EXECUTE FUNCTION trial_submission_activity();
CREATE TRIGGER lesson_cancelled_drops_shift AFTER UPDATE OF status ON public.lessons FOR EACH ROW EXECUTE FUNCTION lesson_cancelled_drops_shift();
CREATE TRIGGER students_status_derived BEFORE INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION students_status_derived();
CREATE TRIGGER enrolments_refresh_student_status AFTER INSERT OR DELETE OR UPDATE ON public.enrolments FOR EACH ROW EXECUTE FUNCTION enrolment_refreshes_student_status();
CREATE TRIGGER chat_messages_students_persona BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION chat_students_persona();
CREATE TRIGGER chat_scheduled_students_persona BEFORE INSERT ON public.chat_scheduled_messages FOR EACH ROW EXECUTE FUNCTION chat_students_persona();
CREATE TRIGGER chat_messages_keep_record BEFORE UPDATE ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION chat_messages_keep_record();
CREATE TRIGGER students_sync_login AFTER INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION student_status_syncs_login();
CREATE TRIGGER chat_members_fixed_keys BEFORE UPDATE ON public.chat_members FOR EACH ROW EXECUTE FUNCTION chat_members_fixed_keys();
CREATE TRIGGER enrolments_trial_activity AFTER UPDATE OF trial_start_date, class_id ON public.enrolments FOR EACH ROW WHEN (((old.trial_start_date IS DISTINCT FROM new.trial_start_date) OR (old.class_id IS DISTINCT FROM new.class_id))) EXECUTE FUNCTION trial_enrolment_touches_submission();
CREATE TRIGGER enrolment_status_sync AFTER UPDATE OF status ON public.enrolments FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION sync_enrolment_to_trial_submission();
CREATE TRIGGER trg_enrolments_trial_submission AFTER INSERT OR UPDATE OF status ON public.enrolments FOR EACH ROW EXECUTE FUNCTION ensure_trial_submission();
