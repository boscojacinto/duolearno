import { Mastra } from "@mastra/core";
import { RedisStore } from "@mastra/redis";
import { analyzeWorkflow } from "./agents/analyze/workflow";
import { learnWorkflow } from "./agents/learn/workflow";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error(
    "REDIS_URL is not set. DuoLearno requires Redis for durable workflow-run and " +
      "session memory. Set REDIS_URL (e.g. redis://localhost:6379) — see .env.example."
  );
}

// Persist Mastra workflow-run snapshots to Redis so suspended runs (e.g. the
// analyze HITL approval) resume by runId across processes, restarts, and
// instances. Mastra lazily initialises the store on first use.
function createMastra() {
  return new Mastra({
    workflows: { analyzeWorkflow, learnWorkflow },
    storage: new RedisStore({ id: "duolearno-mastra", connectionString: REDIS_URL! }),
  });
}

// Pin to globalThis so Next.js HMR / separately-bundled route handlers reuse one
// instance (and one Redis connection) within a single process.
const globalForMastra = globalThis as unknown as { __duolearnoMastra?: ReturnType<typeof createMastra> };

export const mastra = globalForMastra.__duolearnoMastra ?? createMastra();
globalForMastra.__duolearnoMastra = mastra;
