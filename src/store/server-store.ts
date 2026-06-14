import type { Item, DocumentMetadata } from "../types/prerequisite-graph";

interface AnalyzeRunEntry {
  run: { resume: (opts: { step: string; resumeData: Record<string, unknown> }) => Promise<unknown> };
  tmpPath: string;
}

interface QuizSessionEntry {
  items: Item[];
  documentMetadata: DocumentMetadata;
}

// Next.js bundles each route handler separately, so a plain module-level `Map`
// is NOT shared between /api/analyze and /api/analyze/resume — each bundle gets
// its own instance, and the run stored on one is invisible to the other (404
// "Run not found"). HMR recompiles reset module state too. Pinning the maps to
// globalThis gives every bundle the same instance within the single dev/server
// process.
const globalForStore = globalThis as unknown as {
  __duolearnoAnalyzeRuns?: Map<string, AnalyzeRunEntry>;
  __duolearnoQuizSessions?: Map<string, QuizSessionEntry>;
};

export const analyzeRuns: Map<string, AnalyzeRunEntry> =
  globalForStore.__duolearnoAnalyzeRuns ?? new Map();
export const quizSessions: Map<string, QuizSessionEntry> =
  globalForStore.__duolearnoQuizSessions ?? new Map();

globalForStore.__duolearnoAnalyzeRuns = analyzeRuns;
globalForStore.__duolearnoQuizSessions = quizSessions;
