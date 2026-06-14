import { Mastra } from "@mastra/core";
import { analyzeWorkflow } from "./agents/analyze/workflow";
import { learnWorkflow } from "./agents/learn/workflow";

export const mastra = new Mastra({
  workflows: { analyzeWorkflow, learnWorkflow },
});
