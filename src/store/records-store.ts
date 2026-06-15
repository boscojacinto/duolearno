import { randomUUID } from "crypto";
import { Pool } from "pg";
import type {
  Item,
  Edge,
  AssumedPrerequisite,
  LearningPath,
  DocumentMetadata,
} from "../types/prerequisite-graph";
import type { ModuleResult, QuestionResult, PerformanceSummary } from "../types/learning-loop";

// PostgreSQL backs the durable application records: every PDF analysis, each
// quiz session, and the per-module / per-question results. (Redis still backs
// Mastra workflow snapshots and the short-lived quiz-session memory; this store
// is the long-term system of record.)

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. DuoLearno requires PostgreSQL to persist analyses " +
      "and quiz records. Set DATABASE_URL (e.g. postgres://user:pass@localhost:5432/duolearno) — see .env.example."
  );
}

// One pool per process, pinned to globalThis so Next.js HMR and separately
// bundled route handlers reuse a single pool (and the schema is created once).
const globalForPg = globalThis as unknown as {
  __duolearnoPgPool?: Pool;
  __duolearnoPgSchema?: Promise<void>;
};

function getPoolRaw(): Pool {
  if (!globalForPg.__duolearnoPgPool) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    pool.on("error", (err) => console.error("[duolearno] Postgres pool error:", err));
    globalForPg.__duolearnoPgPool = pool;
  }
  return globalForPg.__duolearnoPgPool;
}

// Idempotent schema bootstrap. Runs once per process (memoised promise) so the
// tables exist on first use without a separate migration step — mirroring how
// Mastra lazily initialises its store. The canonical DDL also lives in
// `db/schema.sql` for reference / manual provisioning.
const SCHEMA_SQL = `
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
  source          text NOT NULL DEFAULT 'web',
  status          text NOT NULL DEFAULT 'in_progress',
  total_questions int  NOT NULL DEFAULT 0,
  correct_answers int  NOT NULL DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  summary         jsonb
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
  wrong_attempts       int  NOT NULL DEFAULT 0,
  wrong_option_indices jsonb NOT NULL DEFAULT '[]'::jsonb,
  hints_used           int  NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_analysis ON quiz_sessions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_module_results_session ON module_results(session_id);
CREATE INDEX IF NOT EXISTS idx_question_results_session ON question_results(session_id);

-- Migration for DBs created before the Phase 4 summary column existed
-- (CREATE TABLE IF NOT EXISTS above won't alter an existing table).
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS summary jsonb;
`;

async function getPool(): Promise<Pool> {
  const pool = getPoolRaw();
  globalForPg.__duolearnoPgSchema ??= pool.query(SCHEMA_SQL).then(() => undefined);
  await globalForPg.__duolearnoPgSchema;
  return pool;
}

// ── Analyses ─────────────────────────────────────────────────────────────────

export interface SaveAnalysisInput {
  id?: string;
  documentMetadata: DocumentMetadata;
  items: Item[];
  edges: Edge[];
  assumedPrerequisites: AssumedPrerequisite[];
  clusters?: unknown[];
  learningPath: LearningPath;
  sourceFilename?: string;
}

/** Persist a completed analysis. Returns the analysis id. */
export async function saveAnalysis(input: SaveAnalysisInput): Promise<string> {
  const pool = await getPool();
  const id = input.id ?? randomUUID();
  const dm = input.documentMetadata;
  await pool.query(
    `INSERT INTO analyses
       (id, title, domain, sub_domain, proficiency_band, source_filename,
        document_metadata, items, edges, assumed_prerequisites, clusters, learning_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      input.learningPath.title ?? dm.title ?? "Untitled",
      dm.domain ?? null,
      dm.sub_domain ?? null,
      dm.proficiency_band ?? null,
      input.sourceFilename ?? null,
      JSON.stringify(dm),
      JSON.stringify(input.items),
      JSON.stringify(input.edges),
      JSON.stringify(input.assumedPrerequisites),
      JSON.stringify(input.clusters ?? []),
      JSON.stringify(input.learningPath),
    ]
  );
  return id;
}

export async function analysisExists(id: string): Promise<boolean> {
  if (!id) return false;
  const pool = await getPool();
  const { rowCount } = await pool.query("SELECT 1 FROM analyses WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

// ── Quiz sessions ────────────────────────────────────────────────────────────

export interface CreateQuizSessionInput {
  id?: string;
  analysisId?: string | null;
  title?: string | null;
  source?: "web" | "cli";
}

/**
 * Create a quiz session, or no-op if one with the same id already exists. Lets
 * both the analyze/resume route and the result-recording route ensure the row
 * is present. Returns the session id.
 */
export async function createQuizSession(input: CreateQuizSessionInput = {}): Promise<string> {
  const pool = await getPool();
  const id = input.id ?? randomUUID();
  await pool.query(
    `INSERT INTO quiz_sessions (id, analysis_id, title, source)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [id, input.analysisId ?? null, input.title ?? null, input.source ?? "web"]
  );
  return id;
}

export async function markSessionComplete(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const pool = await getPool();
  await pool.query(
    `UPDATE quiz_sessions
        SET status = 'completed', finished_at = now()
      WHERE id = $1`,
    [sessionId]
  );
}

// ── Phase 4: performance summary read/write ───────────────────────────────────

export interface SessionForSummary {
  moduleResults: ModuleResult[];
  items: Item[];
  edges: Edge[];
  assumedPrerequisites: AssumedPrerequisite[];
  learningPath: LearningPath;
  existingSummary: PerformanceSummary | null;
}

/**
 * Load everything needed to generate (or re-show) a session's performance
 * summary: the recorded results plus the analysis graph they were generated
 * from. Returns undefined if the session (or its analysis) is missing.
 */
export async function getSessionForSummary(
  sessionId: string
): Promise<SessionForSummary | undefined> {
  if (!sessionId) return undefined;
  const pool = await getPool();

  const session = await pool.query(
    `SELECT s.summary, a.items, a.edges, a.assumed_prerequisites, a.learning_path
       FROM quiz_sessions s
       JOIN analyses a ON a.id = s.analysis_id
      WHERE s.id = $1`,
    [sessionId]
  );
  if (session.rowCount === 0) return undefined;
  const row = session.rows[0];

  const mods = await pool.query(
    `SELECT module_id, module_title, total_questions, correct_answers
       FROM module_results
      WHERE session_id = $1
      ORDER BY module_id`,
    [sessionId]
  );
  const questions = await pool.query(
    `SELECT module_id, question, correct_index, user_answer_index, is_correct
       FROM question_results
      WHERE session_id = $1
      ORDER BY module_id, question_index`,
    [sessionId]
  );

  // Group recorded questions back under their module to rebuild ModuleResult[].
  const byModule = new Map<string, QuestionResult[]>();
  for (const q of questions.rows) {
    const list = byModule.get(q.module_id) ?? [];
    list.push({
      question: q.question,
      user_answer_index: q.user_answer_index,
      correct_index: q.correct_index,
      is_correct: q.is_correct,
    });
    byModule.set(q.module_id, list);
  }

  const moduleResults: ModuleResult[] = mods.rows.map((m) => ({
    module_id: m.module_id,
    module_title: m.module_title,
    total_questions: m.total_questions,
    correct_answers: m.correct_answers,
    question_results: byModule.get(m.module_id) ?? [],
  }));

  return {
    moduleResults,
    items: row.items as Item[],
    edges: row.edges as Edge[],
    assumedPrerequisites: (row.assumed_prerequisites ?? []) as AssumedPrerequisite[],
    learningPath: row.learning_path as LearningPath,
    existingSummary: (row.summary ?? null) as PerformanceSummary | null,
  };
}

export async function saveSessionSummary(
  sessionId: string,
  summary: PerformanceSummary
): Promise<void> {
  if (!sessionId) return;
  const pool = await getPool();
  await pool.query("UPDATE quiz_sessions SET summary = $2 WHERE id = $1", [
    sessionId,
    JSON.stringify(summary),
  ]);
}

// ── Per-question results (incremental, web flow) ──────────────────────────────

export interface RecordQuestionInput {
  sessionId: string;
  moduleId?: string | null;
  moduleTitle?: string | null;
  questionIndex: number;
  question: string;
  options: string[];
  correctIndex: number;
  userAnswerIndex: number;
  isCorrect: boolean;
  wrongAttempts?: number;
  wrongOptionIndices?: number[];
  hintsUsed?: number;
}

/**
 * Record one answered question and roll the totals up into its module and
 * session, all in a single transaction. `isCorrect` is the first-attempt
 * correctness (the web flow retries until right, so this is the meaningful
 * score signal).
 */
export async function recordQuestionResult(input: RecordQuestionInput): Promise<void> {
  const pool = await getPool();
  const client = await pool.connect();
  const correctInc = input.isCorrect ? 1 : 0;
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO question_results
         (id, session_id, module_id, module_title, question_index, question, options,
          correct_index, user_answer_index, is_correct, wrong_attempts, wrong_option_indices, hints_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        randomUUID(),
        input.sessionId,
        input.moduleId ?? null,
        input.moduleTitle ?? null,
        input.questionIndex,
        input.question,
        JSON.stringify(input.options),
        input.correctIndex,
        input.userAnswerIndex,
        input.isCorrect,
        input.wrongAttempts ?? 0,
        JSON.stringify(input.wrongOptionIndices ?? []),
        input.hintsUsed ?? 0,
      ]
    );

    if (input.moduleId) {
      await client.query(
        `INSERT INTO module_results
           (id, session_id, module_id, module_title, total_questions, correct_answers)
         VALUES ($1,$2,$3,$4,1,$5)
         ON CONFLICT (session_id, module_id) DO UPDATE
           SET total_questions = module_results.total_questions + 1,
               correct_answers = module_results.correct_answers + $5,
               module_title    = EXCLUDED.module_title,
               updated_at      = now()`,
        [randomUUID(), input.sessionId, input.moduleId, input.moduleTitle ?? "", correctInc]
      );
    }

    await client.query(
      `UPDATE quiz_sessions
          SET total_questions = total_questions + 1,
              correct_answers = correct_answers + $2
        WHERE id = $1`,
      [input.sessionId, correctInc]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Batch results (CLI learn flow) ────────────────────────────────────────────

/**
 * Persist a completed CLI quiz run's module + question results in one
 * transaction and mark the session complete. The CLI `QuestionResult` has no
 * option text or per-question wrong-attempt history, so those columns are left
 * at their defaults.
 */
export async function saveModuleResults(
  sessionId: string,
  moduleResults: ModuleResult[]
): Promise<void> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let sessionTotal = 0;
    let sessionCorrect = 0;

    for (const mod of moduleResults) {
      await client.query(
        `INSERT INTO module_results
           (id, session_id, module_id, module_title, total_questions, correct_answers)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (session_id, module_id) DO UPDATE
           SET total_questions = EXCLUDED.total_questions,
               correct_answers = EXCLUDED.correct_answers,
               module_title    = EXCLUDED.module_title,
               updated_at      = now()`,
        [
          randomUUID(),
          sessionId,
          mod.module_id,
          mod.module_title,
          mod.total_questions,
          mod.correct_answers,
        ]
      );

      for (const [idx, q] of mod.question_results.entries()) {
        sessionTotal += 1;
        sessionCorrect += q.is_correct ? 1 : 0;
        await client.query(
          `INSERT INTO question_results
             (id, session_id, module_id, module_title, question_index, question, options,
              correct_index, user_answer_index, is_correct)
           VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9)`,
          [
            randomUUID(),
            sessionId,
            mod.module_id,
            mod.module_title,
            idx,
            q.question,
            q.correct_index,
            q.user_answer_index,
            q.is_correct,
          ]
        );
      }
    }

    await client.query(
      `UPDATE quiz_sessions
          SET status = 'completed',
              finished_at = now(),
              total_questions = $2,
              correct_answers = $3
        WHERE id = $1`,
      [sessionId, sessionTotal, sessionCorrect]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
