-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Term Transition migrations
-- Run once in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enrolment lifecycle columns
--    Allows marking when and why a student stopped tutoring.
ALTER TABLE enrolments
  ADD COLUMN IF NOT EXISTS ended_at          date,
  ADD COLUMN IF NOT EXISTS end_reason        text,
  ADD COLUMN IF NOT EXISTS next_term_status  text NOT NULL DEFAULT 'confirmed';

ALTER TABLE enrolments
  DROP CONSTRAINT IF EXISTS enrolments_next_term_status_check;
ALTER TABLE enrolments
  ADD CONSTRAINT enrolments_next_term_status_check
  CHECK (next_term_status IN ('confirmed', 'not_continuing'));

-- 2. Term transitions log
--    One row per transition run. Lets you audit past transitions and resume
--    in-progress ones if the page is closed mid-way.
CREATE TABLE IF NOT EXISTS term_transitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_term_id     uuid REFERENCES terms(id) ON DELETE SET NULL,
  to_term_id       uuid REFERENCES terms(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'in_progress',  -- in_progress | complete | cancelled
  completed_steps  text[] NOT NULL DEFAULT '{}',          -- e.g. {'enrolments','classes','comms','invoices'}
  meta             jsonb NOT NULL DEFAULT '{}',            -- snapshot counts, options, created-by email
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

-- Status check constraint
ALTER TABLE term_transitions
  DROP CONSTRAINT IF EXISTS term_transitions_status_check;
ALTER TABLE term_transitions
  ADD CONSTRAINT term_transitions_status_check
  CHECK (status IN ('in_progress', 'complete', 'cancelled'));

-- 3. Enquiries / waitlist
--    Track prospective students from first contact through to enrolment or decline.
CREATE TABLE IF NOT EXISTS enquiries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name   text NOT NULL,
  parent_name    text,
  parent_email   text,
  parent_phone   text,
  year_group     int,
  subjects       text[],               -- e.g. ['Maths', 'English']
  preferred_days text[],               -- e.g. ['Tuesday', 'Saturday']
  source         text,                 -- 'word_of_mouth' | 'google' | 'school' | 'existing_family' | 'social_media' | 'other'
  status         text NOT NULL DEFAULT 'new',  -- new | contacted | trial_booked | enrolled | declined | no_response
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE enquiries
  DROP CONSTRAINT IF EXISTS enquiries_status_check;
ALTER TABLE enquiries
  ADD CONSTRAINT enquiries_status_check
  CHECK (status IN ('new', 'contacted', 'trial_booked', 'enrolled', 'declined', 'no_response'));

-- Auto-update updated_at on enquiries
CREATE OR REPLACE FUNCTION update_enquiries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enquiries_updated_at ON enquiries;
CREATE TRIGGER enquiries_updated_at
  BEFORE UPDATE ON enquiries
  FOR EACH ROW EXECUTE FUNCTION update_enquiries_updated_at();

-- 4. Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_enquiries_status    ON enquiries (status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created   ON enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_term_transitions_to ON term_transitions (to_term_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Tables added/modified:
--   • enrolments.ended_at, enrolments.end_reason, enrolments.next_term_status
--   • term_transitions
--   • enquiries
-- ─────────────────────────────────────────────────────────────────────────────
