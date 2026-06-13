# DuoLearno

An AI learning agent that transforms a PDF into an interactive lesson. Given any educational or technical document, it produces a structured **prerequisite graph** — every concept, skill, and topic extracted and connected by what must be learned before what.

## How it works

The pipeline runs in four phases, each powered by Claude:

```
PDF
 │
 ▼
extract_pdf ──► identify_domain ──► extract_concepts ──► build_graph ──► format_output
                    (Phase 1)           (Phase 2)          (Phase 3)       (Phase 4)
```

| Phase | What Claude produces |
|-------|---------------------|
| 1 — Domain identification | Domain, sub-domain, proficiency band, adjacent domains, summary |
| 2 — Concept extraction | Atomic items (concept / skill / principle / vocabulary) + assumed prerequisites |
| 3 — Prerequisite mapping | Directed edges (direct / soft / co-requisite) + boundary references |
| 4 — Learning order & clustering | Topologically sorted learning order + thematic lesson clusters |

The final output is a single JSON file that maps the entire learning space of the document.

## Output format

```jsonc
{
  "document_metadata": { "domain": "...", "proficiency_band": "intermediate", ... },
  "items": [
    { "id": "calc_derivative_def", "label": "Definition of a Derivative",
      "type": "concept", "difficulty_estimate": 3, ... }
  ],
  "prerequisites_assumed": [ ... ],   // knowledge the document assumes but doesn't teach
  "edges": [
    { "from": "calc_limit_def", "to": "calc_derivative_def", "dependency_type": "direct" }
  ],
  "boundary_references": [ ... ],     // out-of-scope topics mentioned in the document
  "suggested_learning_order": ["calc_limit_def", "calc_derivative_def", ...],
  "clusters": [
    { "cluster_id": "limits", "label": "Limits & Continuity", "item_ids": [...] }
  ]
}
```

## Setup

**Prerequisites:** Node.js 18+, an Anthropic API key.

```bash
git clone <repo>
cd duolearno
npm install
cp .env.example .env
# add your ANTHROPIC_API_KEY to .env
```

## Usage

```bash
npm run dev -- analyze --pdf path/to/document.pdf
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--pdf <path>` | *(required)* | Path to the PDF file |
| `--output <path>` | `prerequisite-graph.json` | Where to write the output JSON |
| `--pretty` | false | Pretty-print the JSON |

Example:

```bash
npm run dev -- analyze --pdf textbook-chapter-3.pdf --output ch3-graph.json --pretty
```

## Development

```bash
npm run typecheck   # type-check without building
npm run build       # compile to dist/
npm start -- analyze --pdf doc.pdf   # run compiled output
```

## Project structure

```
src/
├── index.ts                              CLI entry point
├── types/prerequisite-graph.ts           Zod schemas + TypeScript types (source of truth)
├── tools/pdf-extractor.ts                PDF text extraction (pdf-parse)
└── agents/prerequisite-graph/
    ├── graph.ts                          LangGraph StateGraph wiring
    ├── nodes.ts                          One async function per pipeline phase
    ├── prompts.ts                        LLM prompt builders (tune extraction here)
    └── state.ts                          Shared graph state definition
```

## Roadmap

- [x] Phase 1 — PDF ingestion, analysis, prerequisite graph builder
- [ ] Phase 2 — Interactive lesson generation from the prerequisite graph
- [ ] Persistent storage (PostgreSQL) and session checkpointing (Redis)
