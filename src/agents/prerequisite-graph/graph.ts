import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphStateAnnotation } from "./state";
import {
  extractPdfNode,
  identifyDomainNode,
  extractConceptsNode,
  buildPrerequisiteGraphNode,
  formatOutputNode,
  generateLearningPathNode,
} from "./nodes";

export function buildPrerequisiteGraphAgent() {
  const workflow = new StateGraph(GraphStateAnnotation)
    .addNode("extract_pdf", extractPdfNode)
    .addNode("identify_domain", identifyDomainNode)
    .addNode("extract_concepts", extractConceptsNode)
    .addNode("build_graph", buildPrerequisiteGraphNode)
    .addNode("format_output", formatOutputNode)
    .addNode("generate_learning_path", generateLearningPathNode)
    .addEdge(START, "extract_pdf")
    .addEdge("extract_pdf", "identify_domain")
    .addEdge("identify_domain", "extract_concepts")
    .addEdge("extract_concepts", "build_graph")
    .addEdge("build_graph", "format_output")
    .addEdge("format_output", "generate_learning_path")
    .addEdge("generate_learning_path", END);

  return workflow.compile();
}
