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
