import { createClient } from "redis";
import type {
  Item,
  Edge,
  AssumedPrerequisite,
  LearningPath,
  DocumentMetadata,
} from "../types/prerequisite-graph";

export interface QuizSessionEntry {
  items: Item[];
  documentMetadata: DocumentMetadata;
  // Prerequisite graph from the analyze phase — used to ground hints.
  edges: Edge[];
  assumedPrerequisites: AssumedPrerequisite[];
  learningPath: LearningPath;
  // Postgres analysis id this session was generated from (when persisted).
  analysisId?: string;
}

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error(
    "REDIS_URL is not set. DuoLearno requires Redis for session memory. " +
      "Set REDIS_URL (e.g. redis://localhost:6379) — see .env.example."
  );
}

type RedisClient = ReturnType<typeof createClient>;

// One connected client per process, pinned to globalThis so Next.js HMR and
// separately-bundled route handlers reuse a single connection.
const globalForRedis = globalThis as unknown as { __duolearnoRedis?: Promise<RedisClient> };

async function connect(): Promise<RedisClient> {
  const client: RedisClient = createClient({ url: REDIS_URL });
  client.on("error", (err) => console.error("[duolearno] Redis client error:", err));
  await client.connect();
  return client;
}

function getClient(): Promise<RedisClient> {
  return (globalForRedis.__duolearnoRedis ??= connect());
}

// Quiz sessions carry the analyze-phase graph used to ground hints and generate
// MCQs. Stored in Redis (shared across instances, durable across restarts) with
// a TTL so abandoned sessions expire on their own.
const SESSION_PREFIX = "duolearno:session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h

export const quizSessions = {
  async get(id: string): Promise<QuizSessionEntry | undefined> {
    if (!id) return undefined;
    const client = await getClient();
    const raw = await client.get(SESSION_PREFIX + id);
    return raw ? (JSON.parse(raw) as QuizSessionEntry) : undefined;
  },
  async set(id: string, entry: QuizSessionEntry): Promise<void> {
    const client = await getClient();
    await client.set(SESSION_PREFIX + id, JSON.stringify(entry), { EX: SESSION_TTL_SECONDS });
  },
  async delete(id: string): Promise<void> {
    const client = await getClient();
    await client.del(SESSION_PREFIX + id);
  },
};
