import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { extractPdfText } from "../../tools/pdf-extractor";
import {
  Phase1OutputSchema,
  Phase2OutputSchema,
  Phase3OutputSchema,
  Phase4OutputSchema,
} from "../../types/prerequisite-graph";
import type {
  Phase1Output,
  Phase2Output,
  Phase3Output,
  Phase4Output,
} from "../../types/prerequisite-graph";
import { toGeminiSchema } from "../../tools/gemini-schema";
import {
  AGENT_SYSTEM_PROMPT,
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  buildPhase4Prompt,
} from "./prompts";
import type { GraphState } from "./state";

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-3.5-flash",
  temperature: 0,
  apiKey: process.env.GEMINI_API_KEY,
});

export async function extractPdfNode(state: GraphState): Promise<Partial<GraphState>> {
  console.log("[duolearno] Extracting PDF text...");
  const result = await extractPdfText(state.pdfPath);
  console.log(`[duolearno] Extracted ${result.pageCount} pages, ${result.text.length.toLocaleString()} characters`);
  return {
    extractedText: result.text,
    pageCount: result.pageCount,
    pdfTitle: result.title,
    pdfAuthor: result.author,
  };
}

export async function identifyDomainNode(state: GraphState): Promise<Partial<GraphState>> {
  console.log("[duolearno] Phase 1: Identifying domain...");
  const structured = llm.withStructuredOutput(toGeminiSchema(Phase1OutputSchema), { name: "domain_analysis" });
  const result = (await structured.invoke([
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: buildPhase1Prompt(state.extractedText, state.pdfTitle, state.pdfAuthor) },
  ])) as Phase1Output;
  console.log(`[duolearno]   Domain: ${result.domain} › ${result.sub_domain} (${result.proficiency_band})`);
  return { documentMetadata: result };
}

export async function extractConceptsNode(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.documentMetadata) {
    return { errors: ["Phase 2 skipped: domain metadata missing."] };
  }
  console.log("[duolearno] Phase 2: Extracting concepts, skills, vocabulary...");
  const structured = llm.withStructuredOutput(toGeminiSchema(Phase2OutputSchema), { name: "concept_extraction" });
  const result = (await structured.invoke([
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildPhase2Prompt(
        state.extractedText,
        JSON.stringify(state.documentMetadata, null, 2)
      ),
    },
  ])) as Phase2Output;
  console.log(`[duolearno]   Items: ${result.items.length} extracted, ${result.prerequisites_assumed.length} assumed prerequisites`);
  return {
    items: result.items,
    prerequisitesAssumed: result.prerequisites_assumed,
  };
}

export async function buildPrerequisiteGraphNode(state: GraphState): Promise<Partial<GraphState>> {
  console.log("[duolearno] Phase 3: Building prerequisite graph...");
  const structured = llm.withStructuredOutput(toGeminiSchema(Phase3OutputSchema), { name: "prerequisite_mapping" });
  const result = (await structured.invoke([
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildPhase3Prompt(
        JSON.stringify(state.items, null, 2),
        JSON.stringify(state.prerequisitesAssumed, null, 2)
      ),
    },
  ])) as Phase3Output;
  console.log(`[duolearno]   Edges: ${result.edges.length}, boundary references: ${result.boundary_references.length}`);
  return {
    edges: result.edges,
    boundaryReferences: result.boundary_references,
  };
}

export async function formatOutputNode(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.documentMetadata) {
    return { errors: ["Phase 4 skipped: document metadata missing."] };
  }
  console.log("[duolearno] Phase 4: Computing learning order and clusters...");
  const structured = llm.withStructuredOutput(toGeminiSchema(Phase4OutputSchema), { name: "final_output" });
  const result = (await structured.invoke([
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildPhase4Prompt(
        JSON.stringify(state.items, null, 2),
        JSON.stringify(state.edges, null, 2)
      ),
    },
  ])) as Phase4Output;
  console.log(`[duolearno]   Clusters: ${result.clusters.length}, learning order: ${result.suggested_learning_order.length} steps`);

  return {
    finalOutput: {
      document_metadata: state.documentMetadata,
      items: state.items,
      prerequisites_assumed: state.prerequisitesAssumed,
      edges: state.edges,
      boundary_references: state.boundaryReferences,
      suggested_learning_order: result.suggested_learning_order,
      clusters: result.clusters,
    },
  };
}
