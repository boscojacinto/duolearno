import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { LearningLoopStateAnnotation } from "./state";
import {
  generateMcqsNode,
  presentQuestionNode,
  evaluateAnswerNode,
  routeAfterEvaluate,
} from "./nodes";

export function buildLearningLoopAgent() {
  const checkpointer = new MemorySaver();

  const workflow = new StateGraph(LearningLoopStateAnnotation)
    .addNode("generate_mcqs", generateMcqsNode)
    .addNode("present_question", presentQuestionNode)
    .addNode("evaluate_answer", evaluateAnswerNode)
    .addEdge(START, "generate_mcqs")
    .addEdge("generate_mcqs", "present_question")
    .addEdge("present_question", "evaluate_answer")
    .addConditionalEdges("evaluate_answer", routeAfterEvaluate, {
      next_question: "present_question",
      next_module: "generate_mcqs",
      done: END,
    });

  return workflow.compile({ checkpointer });
}
