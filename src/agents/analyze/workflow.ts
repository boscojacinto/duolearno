import { createWorkflow } from "@mastra/core/workflows";
import {
  WorkflowInputSchema,
  AnalyzeOutputSchema,
  extractPdfStep,
  identifyDomainStep,
  extractConceptsStep,
  buildGraphStep,
  formatOutputStep,
  generateLearningPathStep,
  humanApprovalStep,
} from "./steps";

export const analyzeWorkflow = createWorkflow({
  id: "analyze-workflow",
  inputSchema: WorkflowInputSchema,
  outputSchema: AnalyzeOutputSchema,
})
  .then(extractPdfStep)
  .then(identifyDomainStep)
  .then(extractConceptsStep)
  .then(buildGraphStep)
  .then(formatOutputStep)
  .then(generateLearningPathStep)
  .then(humanApprovalStep)
  .commit();
