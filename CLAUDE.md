# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DuoLearno is an AI learning agent that transforms a PDF into an interactive lesson. It is built in phases; this repo currently contains **Phase 1 (analysis + learning path), Phase 2 (HITL approval gate), and Phase 3 (interactive learning loop)**.

## Commands

```bash
npm install          # install dependencies
# Phase 1+2: analyze a PDF and generate the prerequisite graph JSON
npm run dev -- analyze --pdf path/to/doc.pdf --output out.json --pretty
npm run dev -- analyze --pdf path/to/doc.pdf --from "no prior knowledge" --to "intermediate practitioner" --pretty
# Phase 3: quiz yourself on the output from analyze
npm run dev -- learn --input out.json
npm run build        # compile to dist/
npm run typecheck    # type-check without emitting
```

Requires `.env` with `GEMINI_API_KEY` (see `.env.example`).

## Architecture

The project uses **Mastra** (`@mastra/core`) for workflow orchestration and the **Vercel AI SDK** (`ai`, `@ai-sdk/google`) for LLM calls with structured output.

### Phase 1 + 2: Analyze Workflow (HITL)

A 7-step Mastra workflow that processes a PDF into a structured prerequisite graph and sequenced learning path, then suspends for user approval before writing output.

```
extract-pdf → identify-domain → extract-concepts → build-graph → format-output → generate-learning-path → human-approval [suspend]
```

| Step | What it does |
|------|-------------|
| `extract-pdf` | Reads PDF bytes via `pdf-parse`, returns raw text + page count |
| `identify-domain` | LLM call — domain, sub-domain, proficiency band, summary (Step 1) |
| `extract-concepts` | LLM call — atomic items (concept/skill/principle/vocabulary) + assumed prerequisites (Step 2) |
| `build-graph` | LLM call — directed prerequisite edges + boundary references (Step 3) |
| `format-output` | LLM call — topological learning order + thematic clusters (Step 4) |
| `generate-learning-path` | LLM call — sequenced modules with objectives, time estimates, and milestones (Step 5) |
| `human-approval` | **HITL** — calls `suspend({ summary })` to pause; CLI prints summary and reads y/n; resumes via `run.resume({ step, resumeData: { answer } })` |

Each LLM call uses `generateObject()` from the Vercel AI SDK with a Zod schema for runtime validation.

**Data flow**: Steps use a pass-through accumulated schema pattern — each step's `outputSchema` extends the previous step's `outputSchema` with its new fields. No shared state is needed for the analyze workflow.

**HITL flow**: The CLI calls `run.start()`, checks `result.status === 'suspended'`, reads `result.suspendPayload.summary`, prompts the user, then calls `run.resume({ step: 'human-approval', resumeData: { answer } })`. If the user types `n`, `approvalStatus` is `"rejected"` and no file is written.

### Phase 3: Learn Workflow (Quiz Loop)

A Mastra workflow with a `dountil` loop that quizzes the user on every module. It accepts the analyze output JSON as input (`--input`).

```
init-quiz → [dountil: quiz (suspend per question)] → summary
```

| Step | What it does |
|------|-------------|
| `init-quiz` | Initialises quiz state via `setState` (module index, question index, MCQ arrays, results) |
| `quiz` | On first call: generates MCQs if needed, formats question, calls `suspend({ questionText })`; on resume: evaluates answer, updates state, returns `{ done }` |
| `summary` | Reads `moduleResults` and `learningPath` from shared state; returns them as workflow output |

**Loop flow**: The `dountil` condition exits when `quiz` returns `{ done: true }` (all modules complete). Each iteration = one question (suspend + resume). The CLI loops on `result.status === 'suspended'`, printing the question and reading the user's A/B/C/D input, then calls `run.resume({ step: 'quiz', resumeData: { answer } })`.

**State pattern**: The learn workflow uses `stateSchema` (`QuizStateSchema`) to persist quiz progress across `dountil` iterations and across suspensions. All quiz steps declare the same `stateSchema`.

**MCQ format**: Each MCQ has `question`, 4 `options` (plain strings), `correct_index` (0–3), and `explanation`. The question count per module is `min(6, len(learning_objectives) + 1)`, minimum 3.

### Key files

- `src/types/prerequisite-graph.ts` — Zod schemas and TypeScript types for all data structures; single source of truth for the analyze output JSON shape.
- `src/types/learning-loop.ts` — MCQ, QuestionResult, ModuleResult schemas and types.
- `src/agents/analyze/prompts.ts` — All LLM prompt builders for Phase 1+2; edit here to tune extraction quality.
- `src/agents/analyze/steps.ts` — Seven `createStep` definitions; accumulated pass-through schemas; `humanApprovalStep` with `suspendSchema`/`resumeSchema`.
- `src/agents/analyze/workflow.ts` — Wires the 7 analyze steps with `.then()` chain and `.commit()`.
- `src/agents/learn/prompts.ts` — MCQ generation prompt builder.
- `src/agents/learn/steps.ts` — `initQuizStep`, `quizStep` (suspend/resume + evaluation), `summaryStep`; `QuizStateSchema` shared state.
- `src/agents/learn/workflow.ts` — Wires learn steps: `.then(init).dountil(quiz, condition).then(summary).commit()`.
- `src/mastra.ts` — `Mastra` instance registering both workflows.
- `src/tools/pdf-extractor.ts` — Thin wrapper around `pdf-parse`; returns text, page count, and PDF metadata.
- `src/index.ts` — `commander` CLI entry point (`analyze` and `learn` commands).

### LLM integration

All LLM calls use:
```typescript
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'

const googleAI = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! })
const gemini = googleAI('gemini-2.5-flash')

const { object } = await generateObject({ model: gemini, schema: ZodSchema, system, prompt })
```

### Planned additions

PostgreSQL (Mastra persistent storage) will replace the default in-memory state in later phases, enabling persistent run history and resumable sessions across process restarts.
