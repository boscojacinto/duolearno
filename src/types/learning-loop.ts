import { z } from "zod";

export const MCQSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string(),
});

export const MCQSetSchema = z.object({
  questions: z.array(MCQSchema),
});

export const QuestionResultSchema = z.object({
  question: z.string(),
  user_answer_index: z.number().int(),
  correct_index: z.number().int().min(0).max(3),
  is_correct: z.boolean(),
});

export const ModuleResultSchema = z.object({
  module_id: z.string(),
  module_title: z.string(),
  total_questions: z.number().int(),
  correct_answers: z.number().int(),
  question_results: z.array(QuestionResultSchema),
});

// ── Phase 4: performance summary + study tips ────────────────────────────────

// The LLM's portion of the summary — prose only. Numbers and the focus-area
// module list are computed deterministically in code (see generatePerformanceSummary).
export const PerformanceTipsSchema = z.object({
  headline: z.string(),
  strengths: z.array(z.string()),
  focus_area_tips: z.array(
    z.object({
      module_title: z.string(),
      tip: z.string(),
    })
  ),
  study_tips: z.array(z.string()),
  next_steps: z.string(),
});

export const FocusAreaSchema = z.object({
  module_title: z.string(),
  score_pct: z.number().int(),
  // Graph-grounded foundations to revisit, resolved from the prerequisite edges.
  prerequisite_concepts: z.array(z.string()),
  tip: z.string(),
});

// The stored/returned summary: computed stats + graph-grounded focus areas +
// the LLM's prose. Persisted to quiz_sessions.summary.
export const PerformanceSummarySchema = z.object({
  headline: z.string(),
  accuracy_pct: z.number().int(),
  total_questions: z.number().int(),
  correct_answers: z.number().int(),
  strengths: z.array(z.string()),
  focus_areas: z.array(FocusAreaSchema),
  study_tips: z.array(z.string()),
  next_steps: z.string(),
});

export type MCQ = z.infer<typeof MCQSchema>;
export type MCQSet = z.infer<typeof MCQSetSchema>;
export type QuestionResult = z.infer<typeof QuestionResultSchema>;
export type ModuleResult = z.infer<typeof ModuleResultSchema>;
export type PerformanceTips = z.infer<typeof PerformanceTipsSchema>;
export type FocusArea = z.infer<typeof FocusAreaSchema>;
export type PerformanceSummary = z.infer<typeof PerformanceSummarySchema>;
