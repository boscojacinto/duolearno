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

export type MCQ = z.infer<typeof MCQSchema>;
export type MCQSet = z.infer<typeof MCQSetSchema>;
export type QuestionResult = z.infer<typeof QuestionResultSchema>;
export type ModuleResult = z.infer<typeof ModuleResultSchema>;
