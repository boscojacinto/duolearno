import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphStateAnnotation } from "./state";
import {
  extractPdfNode,
  identifyDomainNode,
  extractConceptsNode,
  buildPrerequisiteGraphNode,
  formatOutputNode,
} from "./nodes";

export function buildPrerequisiteGraphAgent() {
  const workflow = new StateGraph(GraphStateAnnotation)
    .addNode("extract_pdf", extractPdfNode)
    .addNode("identify_domain", identifyDomainNode)
    .addNode("extract_concepts", extractConceptsNode)
    .addNode("build_graph", buildPrerequisiteGraphNode)
    .addNode("format_output", formatOutputNode)
    .addEdge(START, "extract_pdf")
    .addEdge("extract_pdf", "identify_domain")
    .addEdge("identify_domain", "extract_concepts")
    .addEdge("extract_concepts", "build_graph")
    .addEdge("build_graph", "format_output")
    .addEdge("format_output", END);

  return workflow.compile();
}
