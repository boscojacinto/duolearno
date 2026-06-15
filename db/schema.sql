-- DuoLearno PostgreSQL schema (application records).
--
-- This is the canonical reference DDL. The app also creates these tables
-- lazily on first connection (see src/store/records-store.ts), so running this
-- by hand is optional — useful for provisioning or inspection.
--
--   createdb duolearno
--   psql duolearno -f db/schema.sql

CREATE TABLE IF NOT EXISTS analyses (
  id                    uuid PRIMARY KEY,
  title                 text NOT NULL,
  domain                text,
  sub_domain            text,
  proficiency_band      text,
  source_filename       text,
  document_metadata     jsonb NOT NULL,
  items                 jsonb NOT NULL,
  edges                 jsonb NOT NULL,
  assumed_prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
  clusters              jsonb NOT NULL DEFAULT '[]'::jsonb,
  learning_path         jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id              uuid PRIMARY KEY,
  analysis_id     uuid REFERENCES analyses(id) ON DELETE CASCADE,
  title           text,
  source          text NOT NULL DEFAULT 'web',   -- 'web' | 'cli'
  status          text NOT NULL DEFAULT 'in_progress', -- 'in_progress' | 'completed'
  total_questions int  NOT NULL DEFAULT 0,
  correct_answers int  NOT NULL DEFAULT 0,        -- first-attempt correct
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  summary         jsonb                              -- Phase 4 performance summary + study tips
);

CREATE TABLE IF NOT EXISTS module_results (
  id              uuid PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  module_id       text NOT NULL,
  module_title    text NOT NULL,
  total_questions int  NOT NULL DEFAULT 0,
  correct_answers int  NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, module_id)
);

CREATE TABLE IF NOT EXISTS question_results (
  id                   uuid PRIMARY KEY,
  session_id           uuid NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  module_id            text,
  module_title         text,
  question_index       int  NOT NULL,
  question             text NOT NULL,
  options              jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_index        int  NOT NULL,
  user_answer_index    int  NOT NULL,
  is_correct           boolean NOT NULL,
  wrong_attempts       int  NOT NULL DEFAULT 0,    -- wrong tries before correct (web)
  wrong_option_indices jsonb NOT NULL DEFAULT '[]'::jsonb,
  hints_used           int  NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_analysis ON quiz_sessions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_module_results_session ON module_results(session_id);
CREATE INDEX IF NOT EXISTS idx_question_results_session ON question_results(session_id);
