import fs from "fs";
import os from "os";
import path from "path";
import type {
  Item,
  Edge,
  AssumedPrerequisite,
  LearningPath,
  DocumentMetadata,
} from "../types/prerequisite-graph";

interface AnalyzeRunEntry {
  run: { resume: (opts: { step: string; resumeData: Record<string, unknown> }) => Promise<unknown> };
  tmpPath: string;
}

interface QuizSessionEntry {
  items: Item[];
  documentMetadata: DocumentMetadata;
  // Prerequisite graph from the analyze phase — used to ground hints.
  edges: Edge[];
  assumedPrerequisites: AssumedPrerequisite[];
  learningPath: LearningPath;
}

// Next.js bundles each route handler separately, so a plain module-level `Map`
// is NOT shared between /api/analyze and /api/analyze/resume — each bundle gets
// its own instance, and the run stored on one is invisible to the other (404
// "Run not found"). HMR recompiles reset module state too. Pinning the cache to
// globalThis gives every bundle the same instance within the dev/server process.
const globalForStore = globalThis as unknown as {
  __duolearnoAnalyzeRuns?: Map<string, AnalyzeRunEntry>;
  __duolearnoQuizSessions?: Map<string, QuizSessionEntry>;
};

// Holds live Mastra run objects — not serializable, so memory-only.
export const analyzeRuns: Map<string, AnalyzeRunEntry> =
  globalForStore.__duolearnoAnalyzeRuns ?? new Map();
globalForStore.__duolearnoAnalyzeRuns = analyzeRuns;

// In-memory cache for quiz sessions.
const quizSessionCache: Map<string, QuizSessionEntry> =
  globalForStore.__duolearnoQuizSessions ?? new Map();
globalForStore.__duolearnoQuizSessions = quizSessionCache;

// Quiz sessions carry the analyze-phase graph used to ground hints and generate
// MCQs. In-memory storage alone is fragile: a dev-server restart or an HMR full
// reload wipes it, and the learner — whose quiz is still open in the browser —
// then hits "Session not found" when a later request (a hint, the next module's
// questions) needs it. Persisting each session to disk makes the graph durable
// across restarts and reliably available to every route handler. The in-memory
// map stays as a fast cache. (A real DB will replace this; see CLAUDE.md.)
const SESSION_DIR = path.join(os.tmpdir(), "duolearno-sessions");
const sessionFile = (id: string) => path.join(SESSION_DIR, `${encodeURIComponent(id)}.json`);

export const quizSessions = {
  get(id: string): QuizSessionEntry | undefined {
    if (!id) return undefined;
    const cached = quizSessionCache.get(id);
    if (cached) return cached;
    try {
      const entry = JSON.parse(fs.readFileSync(sessionFile(id), "utf-8")) as QuizSessionEntry;
      quizSessionCache.set(id, entry);
      return entry;
    } catch {
      return undefined;
    }
  },
  set(id: string, entry: QuizSessionEntry): void {
    quizSessionCache.set(id, entry);
    try {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
      fs.writeFileSync(sessionFile(id), JSON.stringify(entry), "utf-8");
    } catch {
      // Disk write failed — the in-memory cache still serves this process.
    }
  },
  delete(id: string): void {
    quizSessionCache.delete(id);
    try {
      fs.unlinkSync(sessionFile(id));
    } catch {
      // Already gone.
    }
  },
};
