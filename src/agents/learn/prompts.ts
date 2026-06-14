const JSON_INSTRUCTION = "Respond with ONLY a valid JSON object — no markdown, no explanation, no code fences.";

export const MCQ_SYSTEM_PROMPT = `You are an expert educational assessment designer. Your questions test conceptual understanding and application, not surface-level recall. Distractors are plausible — not obviously wrong.

${JSON_INSTRUCTION}`;

export function buildMCQPrompt(
  moduleTitle: string,
  learningObjectives: string[],
  itemDescriptions: string,
  documentContext: string,
  questionCount: number,
): string {
  const objectives = learningObjectives.map((o, i) => `${i + 1}. ${o}`).join("\n");

  return `## Generate Multiple-Choice Questions

### Module: "${moduleTitle}"

### Learning Objectives
${objectives}

### Concepts Covered
${itemDescriptions}

### Context
${documentContext}

### Task
Generate exactly ${questionCount} multiple-choice questions that test mastery of the learning objectives above.

Rules:
- Each question tests understanding or application — not trivial definition recall.
- Each question has exactly 4 answer options (strings, not labeled).
- Exactly one option is unambiguously correct.
- Distractors must be plausible — a learner with partial knowledge might pick them.
- "explanation" (2–3 sentences): explain WHY the correct answer is right and why the main distractor is wrong.
- Vary difficulty: roughly 1 easier question, the rest medium to hard.
- Do not repeat the same concept in two questions.

Return a JSON object with exactly one key:
- "questions": array of objects, each with:
  - "question": question text (string)
  - "options": array of exactly 4 strings (the answer options)
  - "correct_index": 0-based index of the correct option (integer 0–3)
  - "explanation": explanation string`;
}

// ── Hints (graph-grounded, part of the learn phase) ──────────────────────────

export const HINT_SYSTEM_PROMPT = `You are the tutor inside DuoLearno's learning loop. A learner just answered a quiz question incorrectly. Produce ONE short hint (1–2 sentences) that helps them reason their way to the answer.

You are given the concept(s) the question tests and their PREREQUISITE concepts from the learning graph built during analysis. Build your hint on that graph: remind the learner of the relevant prerequisite idea, or the conceptual link between a prerequisite and the tested concept, that leads toward the answer.

Hard rules:
- NEVER reveal, name, quote, or paraphrase the correct option, and never state an option letter.
- Do not say which options are wrong by letter either.
- Anchor the hint in the tested/prerequisite concepts provided — guide the thinking, do not give the conclusion.
- Each successive hint must be MORE specific than the previous ones, while still not giving the answer away.
- Output only the hint text — no preamble, no markdown.`;

export function buildHintPrompt(params: {
  question: string;
  optionsLabeled: string;
  moduleTitle: string;
  testedConcepts: string;
  prerequisiteConcepts: string;
  correctLabel: string;
  previousHints: string[];
}): string {
  const { question, optionsLabeled, moduleTitle, testedConcepts, prerequisiteConcepts, correctLabel, previousHints } = params;

  const priorHints =
    previousHints.length > 0
      ? `Hints already given (make the next one more specific, do not repeat):\n${previousHints
          .map((h, i) => `${i + 1}. ${h}`)
          .join("\n")}`
      : "No hints given yet — start with a gentle nudge that leans on a prerequisite concept.";

  return `### Module: "${moduleTitle}"

### Question
${question}

### Options
${optionsLabeled}

### Concept(s) this question tests
${testedConcepts || "(not specified)"}

### Prerequisite concepts from the learning graph (foundations to lean on)
${prerequisiteConcepts || "(none recorded for these concepts)"}

### For your reasoning only — NEVER reveal
The correct option is ${correctLabel}.

### Hint history
${priorHints}

Write the next hint now, grounded in the concepts above.`;
}
