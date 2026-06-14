const JSON_INSTRUCTION = "Respond with ONLY a valid JSON object — no markdown, no explanation, no code fences.";

export const AGENT_SYSTEM_PROMPT = `You are a Learning Path Architect — an AI agent that reads educational or technical documents and produces structured prerequisite graphs mapping every concept, skill, and topic along with their dependencies.

Core extraction rules:
- Atomic: extract the smallest independently testable learning unit. "Understand loops" → split into while loops, for loops, loop termination, etc.
- Grounded: only extract items the document teaches, references, or assumes. Never add from general knowledge.
- Conservative edges: only add a prerequisite if B genuinely cannot be understood without A. If in doubt, omit.
- No transitive edges: if A→B→C exists, don't add A→C unless C has a direct dependency on A beyond what B provides.
- DAG only: no cycles. If you detect one, split the coarser item.

${JSON_INSTRUCTION}`;

export function buildPhase1Prompt(documentText: string, pdfTitle: string | null, pdfAuthor: string | null): string {
  const metaHint = [
    pdfTitle ? `PDF metadata title: "${pdfTitle}"` : null,
    pdfAuthor ? `PDF metadata author: "${pdfAuthor}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `## Step 1: Domain Identification

${metaHint ? `${metaHint}\n` : ""}Analyze this document and classify it:

1. Identify the **primary domain** (e.g., Mathematics, Computer Science, Biology, Music Theory).
2. Identify the **sub-domain** (e.g., Linear Algebra, Backend Web Development).
3. Estimate the **proficiency band**: foundational | intermediate | advanced | expert.
   - foundational: assumes no prior knowledge in the sub-domain
   - intermediate: assumes basic literacy, builds toward working competence
   - advanced: assumes working competence, targets deep expertise
   - expert: assumes deep expertise, covers frontier or research-level material
4. List **adjacent domains** the material draws from.
5. Write a 2–3 sentence **summary** of what the document covers.

If the PDF metadata title/author above is present, use it; otherwise infer from the document text.

Return a JSON object with keys: title, author, domain, sub_domain, proficiency_band, adjacent_domains, summary.

---
DOCUMENT TEXT:
${documentText}`;
}

export function buildPhase2Prompt(documentText: string, domainContext: string): string {
  return `## Step 2: Concept Extraction

Domain context from Phase 1:
${domainContext}

Scan the entire document and extract every discrete learning item — the smallest unit a learner could be tested on independently.

Item types:
- **concept**: Declarative knowledge (e.g., "what is a linked list", "definition of entropy")
- **skill**: Procedural ability (e.g., "implement binary search", "balance a chemical equation")
- **principle**: Governing rule, law, or heuristic (e.g., "DRY principle", "conservation of energy")
- **vocabulary**: Domain-specific terminology (e.g., "eigenvalue", "mitosis", "syncopation")

Rules:
- Be atomic: "understand loops" → "understand while loops", "understand for loops", "understand loop termination conditions".
- Implicit prerequisites: if the document assumes knowledge without teaching it, include it with implicit: true and put it in prerequisites_assumed (not items).
- Out-of-scope mentions: if the doc says "X is beyond our scope", that's a boundary_reference — do NOT extract it here; it will be handled in Phase 3.
- difficulty_estimate (1–10): base on conceptual complexity, abstraction level, and prerequisite count within this document.

Return a JSON object with exactly two keys:
- "items": array of items the document teaches. Each item: { id, label, type, description, source_location, difficulty_estimate, implicit: false }
- "prerequisites_assumed": array of assumed prerequisites from other domains. Each: { id, label, type, description, estimated_domain, estimated_proficiency, implicit: true }

---
DOCUMENT TEXT:
${documentText}`;
}

export function buildPhase3Prompt(
  items: string,
  prerequisitesAssumed: string
): string {
  return `## Step 3: Prerequisite Mapping

Build directed edges representing prerequisite relationships. An edge from A → B means "A must be understood before B."

Items extracted in Phase 2:
${items}

Assumed prerequisites (external knowledge):
${prerequisitesAssumed}

Edge types:
- **direct**: B explicitly uses, applies, or builds on A. B cannot be understood without A.
- **soft**: B is easier with A but A is not strictly required.
- **co-requisite**: A and B are best learned together; neither strictly requires the other.

Rules:
- No circular dependencies. If you spot a cycle, one item is too coarse — but do not split it here, just omit the cycle-creating edge and add a note.
- Minimize transitive edges: if A→B→C already exists, don't add A→C unless C has a direct non-transitive need for A.
- Assumed prerequisites (from the list above) may also be sources of edges into items.

Also extract **boundary_references**: concepts mentioned as out of scope in the source material. Infer these from item descriptions and source_location hints.

Return a JSON object with exactly two keys:
- "edges": array of { from, to, dependency_type } objects
- "boundary_references": array of { id, label, description, mentioned_in, estimated_domain } objects`;
}

export function buildPhase4Prompt(items: string, edges: string): string {
  return `## Step 4: Learning Order & Clustering

Given the items and prerequisite edges below, produce:

1. **suggested_learning_order**: A topologically sorted list of item IDs respecting all prerequisite edges. Where multiple valid orderings exist, prefer the one that keeps thematically related items close together.

2. **clusters**: Group items into thematic clusters corresponding to natural "units" or "lessons." Each cluster should be cohesive enough for a learner to study in one sitting or short sequence.

Items:
${items}

Prerequisite edges:
${edges}

Rules:
- Every item ID in suggested_learning_order must appear in the items list above.
- No item should appear before its prerequisites in suggested_learning_order.
- Every item must appear in exactly one cluster.

Return a JSON object with exactly two keys:
- "suggested_learning_order": array of item ID strings
- "clusters": array of { cluster_id, label, item_ids, description } objects`;
}

export function buildPhase5Prompt(
  documentMetadata: string,
  items: string,
  clusters: string,
  suggestedLearningOrder: string,
  prerequisitesAssumed: string,
  fromLevelHint: string,
  toLevelHint: string,
): string {
  const levelOverride = (fromLevelHint || toLevelHint)
    ? [
        fromLevelHint ? `The learner's starting level is: ${fromLevelHint}` : null,
        toLevelHint   ? `The learner's target level is: ${toLevelHint}`    : null,
      ]
        .filter(Boolean)
        .join("\n") + "\n\n"
    : "";

  return `## Step 5: Learning Path Generation

${levelOverride}Generate a structured, sequenced learning path from the prerequisite graph below. Your output must be a concrete guide a learner can follow from their starting competency to the document's target competency.

### Document Metadata
${documentMetadata}

### Assumed Prerequisites (entry bar)
${prerequisitesAssumed}

### Extracted Items (concepts / skills / principles / vocabulary)
${items}

### Thematic Clusters (natural lesson groupings, pre-sorted in topological order)
${clusters}

### Suggested Learning Order (topologically sorted item IDs)
${suggestedLearningOrder}

### Instructions

**title**: Write a learner-facing title for this learning path (e.g., "Introduction to MRI Physics for Neuroimagers").

**from_level**: Describe the assumed starting competency in plain language. Synthesise it from the prerequisites_assumed list above. If a hint was provided above, use it verbatim.

**to_level**: Describe what the learner will be able to do after completing every module. Derive it from the domain, sub_domain, and proficiency_band. If a hint was provided above, use it verbatim.

**prerequisites_summary**: A 2–3 sentence paragraph shown to learners before they start, listing the assumed prerequisite knowledge and explaining why it matters.

**modules**: One module per cluster, in the order the clusters appear above. For each module:
- module_id: use sequential identifiers M1, M2, M3, … in the order the clusters appear (independent of cluster_id).
- title: a learner-facing title (can equal the cluster label or be more descriptive).
- cluster_id: copy the cluster_id exactly.
- learning_objectives: 3–5 strings starting with an action verb (e.g., "Explain the role of the B0 field", "Calculate Larmor frequency given field strength"). Each objective maps to items in this cluster.
- item_ids: copy the cluster's item_ids exactly — do not reorder or omit.
- estimated_minutes: estimate study time. Use 15 minutes per item as your baseline, then adjust upward if the average difficulty_estimate for items in this cluster is above 6, or downward if below 3. Round to the nearest 5 minutes.
- is_milestone: set to true if this module concludes a major conceptual arc or is a gatekeeper for a large subsequent cluster. Aim for 2–3 milestones across the whole path.
- milestone_description: if is_milestone is true, one sentence describing the competency achieved. If is_milestone is false, write an empty string "".

**total_estimated_minutes**: sum of all module estimated_minutes.

Preserve all IDs exactly as they appear in the input.`;
}
