# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DuoLearno is an AI learning agent that transforms a PDF into an interactive lesson. It is built in phases; this repo currently contains **Phase 1: PDF ingestion, analysis, prerequisite graph builder, and learning path generator**.

## Commands

```bash
npm install          # install dependencies
npm run dev -- analyze --pdf path/to/doc.pdf --output out.json --pretty
npm run dev -- analyze --pdf path/to/doc.pdf --from "no prior knowledge" --to "intermediate practitioner" --pretty
npm run build        # compile to dist/
npm run typecheck    # type-check without emitting
```

Requires `.env` with `GEMINI_API_KEY` (see `.env.example`).

## Architecture

### Phase 1: Prerequisite Graph + Learning Path Agent

A 6-node LangGraph pipeline that processes a PDF into a structured prerequisite graph and sequenced learning path (JSON).

```
extract_pdf → identify_domain → extract_concepts → build_graph → format_output → generate_learning_path
```

| Node | What it does |
|------|-------------|
| `extract_pdf` | Reads PDF bytes via `pdf-parse`, returns raw text + page count |
| `identify_domain` | LLM call — domain, sub-domain, proficiency band, summary (Step 1) |
| `extract_concepts` | LLM call — atomic items (concept/skill/principle/vocabulary) + assumed prerequisites (Step 2) |
| `build_graph` | LLM call — directed prerequisite edges + boundary references (Step 3) |
| `format_output` | LLM call — topological learning order + thematic clusters (Step 4) |
| `generate_learning_path` | LLM call — sequenced modules with objectives, time estimates, and milestones (Step 5) |

Each LLM call uses `ChatGoogleGenerativeAI.withStructuredOutput(GeminiSchema)` so outputs are validated at runtime.

### Key files

- `src/types/prerequisite-graph.ts` — Zod schemas and TypeScript types for all data structures; single source of truth for the output JSON shape.
- `src/agents/prerequisite-graph/prompts.ts` — All LLM prompt builders; edit here to tune extraction quality.
- `src/agents/prerequisite-graph/nodes.ts` — One async function per graph node; each returns `Partial<GraphState>`.
- `src/agents/prerequisite-graph/state.ts` — LangGraph `Annotation.Root` state definition (camelCase keys; Zod schemas use snake_case to match output JSON).
- `src/agents/prerequisite-graph/graph.ts` — Wires nodes into the `StateGraph` and compiles it.
- `src/tools/pdf-extractor.ts` — Thin wrapper around `pdf-parse`; returns text, page count, and PDF metadata.
- `src/index.ts` — `commander` CLI entry point (`analyze` command).

### State key naming

Graph state uses **camelCase** (`prerequisitesAssumed`, `boundaryReferences`). The output JSON and Zod schemas use **snake_case** (`prerequisites_assumed`, `boundary_references`) to match the specification.

### Planned additions

Redis (LangGraph checkpointing) and PostgreSQL (persistent storage) will be added in later phases. The `workflow.compile()` call in `graph.ts` accepts a `checkpointer` argument — that's where the Redis/Postgres checkpointer will be wired in.
