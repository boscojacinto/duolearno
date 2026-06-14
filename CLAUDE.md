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

### Phase 1 + 2: Prerequisite Graph + Learning Path Agent with HITL Approval

A 7-node LangGraph pipeline that processes a PDF into a structured prerequisite graph and sequenced learning path, then pauses for user approval before writing output.

```
extract_pdf → identify_domain → extract_concepts → build_graph → format_output → generate_learning_path → human_approval
```

| Node | What it does |
|------|-------------|
| `extract_pdf` | Reads PDF bytes via `pdf-parse`, returns raw text + page count |
| `identify_domain` | LLM call — domain, sub-domain, proficiency band, summary (Step 1) |
| `extract_concepts` | LLM call — atomic items (concept/skill/principle/vocabulary) + assumed prerequisites (Step 2) |
| `build_graph` | LLM call — directed prerequisite edges + boundary references (Step 3) |
| `format_output` | LLM call — topological learning order + thematic clusters (Step 4) |
| `generate_learning_path` | LLM call — sequenced modules with objectives, time estimates, and milestones (Step 5) |
| `human_approval` | **HITL** — calls `interrupt()` to pause; CLI displays plan summary and reads y/n from stdin; resumes via `Command({ resume })` |

Each LLM call uses `ChatGoogleGenerativeAI.withStructuredOutput(GeminiSchema)` so outputs are validated at runtime.

**HITL flow**: The graph compiles with a `MemorySaver` checkpointer. The CLI streams the graph until the interrupt fires, calls `agent.getState()` to read the interrupt value (formatted plan summary), prompts the user, then resumes with `agent.stream(new Command({ resume: answer }))`. If the user types `n`, `approvalStatus` is set to `"rejected"` and no file is written.

### Phase 3: Learning Loop

A 3-node LangGraph loop that quizzes the user on every module from the Phase 1+2 output. It accepts the analyze output JSON as input (`--input`).

```
generate_mcqs → present_question [interrupt] → evaluate_answer
     ↑ (next_module) ←──────────────────────────────────┘
          ↑ (next_question) ←────── present_question ←──┘
                                                    done → END
```

| Node | What it does |
|------|-------------|
| `generate_mcqs` | LLM call — generates 3–6 MCQs for the current module (scales with number of learning objectives) |
| `present_question` | Calls `interrupt()` with the formatted question; resumes with the user's A/B/C/D answer |
| `evaluate_answer` | Grades the answer, prints feedback + explanation inline; routes to `next_question`, `next_module`, or `done` |

**Loop flow**: After each module finishes, a score summary is printed inline. After all modules complete, the CLI reads final state and prints an overall session summary with per-module scores.

**MCQ format**: Each MCQ has `question`, 4 `options` (plain strings), `correct_index` (0–3), and `explanation`. The question count per module is `min(6, len(learning_objectives) + 1)`, minimum 3.

### Key files

- `src/types/prerequisite-graph.ts` — Zod schemas and TypeScript types for all data structures; single source of truth for the analyze output JSON shape.
- `src/types/learning-loop.ts` — MCQ, QuestionResult, ModuleResult schemas and types.
- `src/agents/prerequisite-graph/prompts.ts` — All LLM prompt builders for Phase 1+2; edit here to tune extraction quality.
- `src/agents/prerequisite-graph/nodes.ts` — One async function per graph node; each returns `Partial<GraphState>`.
- `src/agents/prerequisite-graph/state.ts` — LangGraph `Annotation.Root` state definition (camelCase keys; Zod schemas use snake_case to match output JSON).
- `src/agents/prerequisite-graph/graph.ts` — Wires Phase 1+2 nodes into the `StateGraph` and compiles it.
- `src/agents/learning-loop/prompts.ts` — MCQ generation prompt builder.
- `src/agents/learning-loop/nodes.ts` — `generateMcqsNode`, `presentQuestionNode`, `evaluateAnswerNode`, and `routeAfterEvaluate`.
- `src/agents/learning-loop/state.ts` — LangGraph state for the learning loop agent.
- `src/agents/learning-loop/graph.ts` — Wires Phase 3 nodes into the `StateGraph` and compiles it.
- `src/tools/pdf-extractor.ts` — Thin wrapper around `pdf-parse`; returns text, page count, and PDF metadata.
- `src/index.ts` — `commander` CLI entry point (`analyze` and `learn` commands).

### State key naming

Graph state uses **camelCase** (`prerequisitesAssumed`, `boundaryReferences`). The output JSON and Zod schemas use **snake_case** (`prerequisites_assumed`, `boundary_references`) to match the specification.

### Planned additions

Redis (LangGraph checkpointing) and PostgreSQL (persistent storage) will be added in later phases. The `MemorySaver` in both `graph.ts` files will be swapped for a Redis/Postgres checkpointer at the same `compile({ checkpointer })` call site.
