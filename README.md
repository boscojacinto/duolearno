# DuoLearno

An AI learning agent that turns a **PDF into an interactive lesson**. It reads a
document, maps its concepts into a prerequisite graph, sequences them into a
learning path, then quizzes you module by module — adapting with graph-grounded
hints and finishing with a personalized performance summary.

Available as a **CLI** and a **web app** (Next.js + CopilotKit).

## How it works

The agent runs in phases:

| Phase | What it does |
|-------|--------------|
| **1 — Analysis** | Extracts the PDF, identifies the domain, pulls out atomic concepts/skills, builds a directed prerequisite graph, and generates a sequenced learning path (modules, objectives, milestones). |
| **2 — Approval (HITL)** | Pauses and shows you a **learning-plan summary** plus a **quiz plan** (MCQ cadence: logic, difficulty progression, milestone checkpoints) to approve before anything is finalized. |
| **3 — Interactive quiz** | Quizzes you on every module with multiple-choice questions. Wrong answers get **graph-grounded hints** (built on prerequisite concepts) and let you retry — the answer is never revealed. |
| **4 — Performance summary** | Generates a personalized summary with strengths, focus areas, and study tips, grounding weak-area advice in the specific prerequisite concepts to revisit. |

## Stack

- **[Mastra](https://mastra.ai)** (`@mastra/core`) — workflow orchestration (suspend/resume for the approval gate and the quiz loop).
- **AI SDK** (`ai`, `@ai-sdk/google`) — structured LLM calls with Zod validation.
- **Google Gemini** — the underlying model.
- **Next.js 14 + [CopilotKit](https://copilotkit.ai) v2** — the web UI and agent runtime.
- **Redis** — Mastra workflow-run snapshots + short-lived quiz-session memory.
- **PostgreSQL** — durable system of record (analyses, quiz sessions, per-module and per-question results, performance summaries).

## Setup

**Prerequisites:** Node.js 18+, Docker (for Redis + Postgres), and a Google Gemini API key.

```bash
git clone <repo>
cd duolearno
npm install

# Start Redis + Postgres locally
docker compose up -d

# Configure environment
cp .env.example .env
# then edit .env — set GEMINI_API_KEY (and GOOGLE_API_KEY to the same value)
```

`.env` keys:

| Key | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Google Gemini key (required). |
| `GOOGLE_API_KEY` | Same value — used by the CopilotKit agent. |
| `REDIS_URL` | Redis connection (default `redis://localhost:6379`). |
| `DATABASE_URL` | Postgres connection (default `postgres://postgres:postgres@localhost:5432/duolearno`). |
| `COPILOTKIT_TELEMETRY_DISABLED` | Optional — set to `true` to opt out of CopilotKit telemetry. |

Postgres tables are created automatically on first use; `db/schema.sql` is the reference DDL.

## Usage

### Web app

```bash
npm run dev:web          # Next.js dev server (http://localhost:3000)
npm run dev:web:turbo    # same, with Turbopack (faster compiles)
```

Upload a PDF → watch the analysis steps stream live → review the learning plan
and quiz plan → take the quiz (with hints and retries) → get your performance
summary.

### CLI

```bash
# Phase 1+2: analyze a PDF into a prerequisite graph + learning path
npm run dev -- analyze --pdf path/to/document.pdf --output out.json --pretty

# Optionally steer the start/target competency
npm run dev -- analyze --pdf doc.pdf --from "no prior knowledge" --to "intermediate practitioner"

# Skip the approval gate and write output immediately
npm run dev -- analyze --pdf doc.pdf --no-hitl

# Phase 3+4: quiz yourself on the analyze output (prints a performance summary at the end)
npm run dev -- learn --input out.json
```

`analyze` options:

| Flag | Default | Description |
|------|---------|-------------|
| `--pdf <path>` | *(required)* | Path to the PDF file |
| `--output <path>` | `prerequisite-graph.json` | Where to write the output JSON |
| `--pretty` | false | Pretty-print the JSON |
| `--from <level>` | — | Override the learner's starting level (free text) |
| `--to <level>` | — | Override the learner's target level (free text) |
| `--no-hitl` | — | Skip the human-approval step |

## Development

```bash
npm run typecheck    # type-check the CLI (tsc, no emit)
npm run build        # compile the CLI to dist/
npm run build:web    # production build of the web app
```

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture (workflow steps, data
flow, storage layout, and key files).
