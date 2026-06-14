import { createWorkflow } from "@mastra/core/workflows";
import {
  LearnInputSchema,
  LearnOutputSchema,
  QuizStateSchema,
  initQuizStep,
  quizStep,
  summaryStep,
} from "./steps";

export const learnWorkflow = createWorkflow({
  id: "learn-workflow",
  inputSchema: LearnInputSchema,
  outputSchema: LearnOutputSchema,
  stateSchema: QuizStateSchema,
})
  .then(initQuizStep)
  .dountil(quizStep, async ({ inputData }) => inputData.done)
  .then(summaryStep)
  .commit();
