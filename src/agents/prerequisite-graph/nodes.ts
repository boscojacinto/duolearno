import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { interrupt } from "@langchain/langgraph";
import { extractPdfText } from "../../tools/pdf-extractor";
import {
  Phase1OutputSchema,
  Phase2OutputSchema,
  Phase3OutputSchema,
  Phase4OutputSchema,
  Phase5OutputSchema,
} from "../../types/prerequisite-graph";
import type {
  Phase1Output,
  Phase2Output,
  Phase3Output,
  Phase4Output,
  Phase5Output,
  LearningModule,
} from "../../types/prerequisite-graph";
import { toGeminiSchema } from "../../tools/gemini-schema";
import {
  AGENT_SYSTEM_PROMPT,
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  buildPhase4Prompt,
  buildPhase5Prompt,
} from "./prompts";
import type { GraphState } from "./state";

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
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
  console.log("[duolearno] Step 1: Identifying domain...");
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
  console.log("[duolearno] Step 2: Extracting concepts, skills, vocabulary...");
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
  console.log("[duolearno] Step 3: Building prerequisite graph...");
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
  console.log("[duolearno] Step 4: Computing learning order and clusters...");
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

export async function generateLearningPathNode(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.finalOutput) {
    return { errors: ["Phase 5 skipped: finalOutput missing."] };
  }
  console.log("[duolearno] Step 5: Generating learning path...");

  const { document_metadata, items, clusters, suggested_learning_order, prerequisites_assumed } = state.finalOutput;

  const orderedClusters = [...clusters].sort((a, b) => {
    const aIdx = Math.min(...a.item_ids.map(id => suggested_learning_order.indexOf(id)).filter(i => i >= 0));
    const bIdx = Math.min(...b.item_ids.map(id => suggested_learning_order.indexOf(id)).filter(i => i >= 0));
    return aIdx - bIdx;
  });

  const trimmedItems = items.map(({ id, label, type, difficulty_estimate, description }) => ({
    id, label, type, difficulty_estimate, description,
  }));

  const structured = llm.withStructuredOutput(toGeminiSchema(Phase5OutputSchema), { name: "learning_path" });
  const result = (await structured.invoke([
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildPhase5Prompt(
        JSON.stringify(document_metadata, null, 2),
        JSON.stringify(trimmedItems, null, 2),
        JSON.stringify(orderedClusters, null, 2),
        JSON.stringify(suggested_learning_order, null, 2),
        JSON.stringify(prerequisites_assumed, null, 2),
        state.fromLevel,
        state.toLevel,
      ),
    },
  ])) as Phase5Output;

  result.modules = result.modules.map((m: LearningModule, i: number) => ({
    ...m,
    module_id: `M${i + 1}`,
  }));
  result.total_estimated_minutes = result.modules.reduce((s: number, m: LearningModule) => s + m.estimated_minutes, 0);
  console.log(`[duolearno]   Modules: ${result.modules.length}, total: ${result.total_estimated_minutes} min`);

  return { learningPath: result };
}

function formatPlanSummary(state: GraphState): string {
  const meta = state.documentMetadata;
  const lp = state.learningPath;
  if (!meta || !lp) return "(plan unavailable)";

  const hr = "─".repeat(56);
  const lines: string[] = [
    "",
    hr,
    "  LEARNING PLAN SUMMARY",
    hr,
    "",
    `  Document   : ${meta.title}`,
    `  Domain     : ${meta.domain} › ${meta.sub_domain}`,
    `  Level band : ${meta.proficiency_band}`,
    `  From → To  : ${lp.from_level || "no prior knowledge"} → ${lp.to_level || "practitioner"}`,
    `  Study time : ~${lp.total_estimated_minutes} min across ${lp.modules.length} module${lp.modules.length !== 1 ? "s" : ""}`,
    "",
    "  MODULES:",
  ];

  for (const mod of lp.modules) {
    const milestone = mod.is_milestone ? " ✦ milestone" : "";
    lines.push(`    ${mod.module_id}. ${mod.title} (${mod.estimated_minutes} min)${milestone}`);
    if (mod.learning_objectives.length > 0) {
      lines.push(`       ↳ ${mod.learning_objectives[0]}`);
    }
  }

  if (state.prerequisitesAssumed.length > 0) {
    const prereqLabels = state.prerequisitesAssumed.slice(0, 5).map((p) => p.label).join(", ");
    const more = state.prerequisitesAssumed.length > 5 ? ` (+${state.prerequisitesAssumed.length - 5} more)` : "";
    lines.push("", `  Prerequisites assumed: ${prereqLabels}${more}`);
  }

  lines.push("", hr, "");
  return lines.join("\n");
}

export async function humanApprovalNode(state: GraphState): Promise<Partial<GraphState>> {
  const summary = formatPlanSummary(state);
  const response = interrupt(summary) as string;

  const normalized = response.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes" || normalized === "approve" || normalized === "ok") {
    console.log("[duolearno] Plan approved.");
    return { approvalStatus: "approved" };
  }

  console.log("[duolearno] Plan rejected.");
  return { approvalStatus: "rejected", userFeedback: response.trim() };
}
