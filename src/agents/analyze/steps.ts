import { createStep } from "@mastra/core/workflows";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import { extractPdfText } from "../../tools/pdf-extractor";
import {
  Phase1OutputSchema,
  Phase2OutputSchema,
  Phase3OutputSchema,
  Phase4OutputSchema,
  Phase5OutputSchema,
  DocumentMetadataSchema,
  ItemSchema,
  AssumedPrerequisiteSchema,
  EdgeSchema,
  BoundaryReferenceSchema,
  ClusterSchema,
  LearningPathSchema,
} from "../../types/prerequisite-graph";
import type { LearningModule } from "../../types/prerequisite-graph";
import {
  AGENT_SYSTEM_PROMPT,
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  buildPhase4Prompt,
  buildPhase5Prompt,
} from "./prompts";

const googleAI = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const gemini = googleAI("gemini-2.5-flash");

// ── Accumulated pass-through schemas ────────────────────────────────────────

export const WorkflowInputSchema = z.object({
  pdfPath: z.string(),
  fromLevel: z.string(),
  toLevel: z.string(),
});

const S1 = z.object({
  extractedText: z.string(),
  pageCount: z.number(),
  pdfTitle: z.string().nullable(),
  pdfAuthor: z.string().nullable(),
  fromLevel: z.string(),
  toLevel: z.string(),
});

const S2 = S1.extend({ documentMetadata: DocumentMetadataSchema });

const S3 = S2.extend({
  items: z.array(ItemSchema),
  prerequisitesAssumed: z.array(AssumedPrerequisiteSchema),
});

const S4 = S3.extend({
  edges: z.array(EdgeSchema),
  boundaryReferences: z.array(BoundaryReferenceSchema),
});

const S5 = S4.extend({
  suggestedLearningOrder: z.array(z.string()),
  clusters: z.array(ClusterSchema),
});

export const S6 = S5.extend({ learningPath: LearningPathSchema });

export const AnalyzeOutputSchema = z.object({
  approvalStatus: z.enum(["approved", "rejected"]),
  userFeedback: z.string(),
  finalOutput: z
    .object({
      document_metadata: DocumentMetadataSchema,
      items: z.array(ItemSchema),
      prerequisites_assumed: z.array(AssumedPrerequisiteSchema),
      edges: z.array(EdgeSchema),
      boundary_references: z.array(BoundaryReferenceSchema),
      suggested_learning_order: z.array(z.string()),
      clusters: z.array(ClusterSchema),
    })
    .nullable(),
  learningPath: LearningPathSchema.nullable(),
  errors: z.array(z.string()),
});

// ── Steps ────────────────────────────────────────────────────────────────────

export const extractPdfStep = createStep({
  id: "extract-pdf",
  inputSchema: WorkflowInputSchema,
  outputSchema: S1,
  execute: async ({ inputData }) => {
    console.log("[duolearno] Extracting PDF text...");
    const result = await extractPdfText(inputData.pdfPath);
    console.log(
      `[duolearno] Extracted ${result.pageCount} pages, ${result.text.length.toLocaleString()} characters`
    );
    return {
      extractedText: result.text,
      pageCount: result.pageCount,
      pdfTitle: result.title ?? null,
      pdfAuthor: result.author ?? null,
      fromLevel: inputData.fromLevel,
      toLevel: inputData.toLevel,
    };
  },
});

export const identifyDomainStep = createStep({
  id: "identify-domain",
  inputSchema: S1,
  outputSchema: S2,
  execute: async ({ inputData }) => {
    console.log("[duolearno] Step 1: Identifying domain...");
    const { object } = await generateObject({
      model: gemini,
      schema: Phase1OutputSchema,
      system: AGENT_SYSTEM_PROMPT,
      prompt: buildPhase1Prompt(inputData.extractedText, inputData.pdfTitle, inputData.pdfAuthor),
    });
    console.log(`[duolearno]   Domain: ${object.domain} › ${object.sub_domain} (${object.proficiency_band})`);
    return { ...inputData, documentMetadata: object };
  },
});

export const extractConceptsStep = createStep({
  id: "extract-concepts",
  inputSchema: S2,
  outputSchema: S3,
  execute: async ({ inputData }) => {
    console.log("[duolearno] Step 2: Extracting concepts, skills, vocabulary...");
    const { object } = await generateObject({
      model: gemini,
      schema: Phase2OutputSchema,
      system: AGENT_SYSTEM_PROMPT,
      prompt: buildPhase2Prompt(
        inputData.extractedText,
        JSON.stringify(inputData.documentMetadata, null, 2)
      ),
    });
    console.log(
      `[duolearno]   Items: ${object.items.length} extracted, ${object.prerequisites_assumed.length} assumed prerequisites`
    );
    return {
      ...inputData,
      items: object.items,
      prerequisitesAssumed: object.prerequisites_assumed,
    };
  },
});

export const buildGraphStep = createStep({
  id: "build-graph",
  inputSchema: S3,
  outputSchema: S4,
  execute: async ({ inputData }) => {
    console.log("[duolearno] Step 3: Building prerequisite graph...");
    const { object } = await generateObject({
      model: gemini,
      schema: Phase3OutputSchema,
      system: AGENT_SYSTEM_PROMPT,
      prompt: buildPhase3Prompt(
        JSON.stringify(inputData.items, null, 2),
        JSON.stringify(inputData.prerequisitesAssumed, null, 2)
      ),
    });
    console.log(
      `[duolearno]   Edges: ${object.edges.length}, boundary references: ${object.boundary_references.length}`
    );
    return {
      ...inputData,
      edges: object.edges,
      boundaryReferences: object.boundary_references,
    };
  },
});

export const formatOutputStep = createStep({
  id: "format-output",
  inputSchema: S4,
  outputSchema: S5,
  execute: async ({ inputData }) => {
    console.log("[duolearno] Step 4: Computing learning order and clusters...");
    const { object } = await generateObject({
      model: gemini,
      schema: Phase4OutputSchema,
      system: AGENT_SYSTEM_PROMPT,
      prompt: buildPhase4Prompt(
        JSON.stringify(inputData.items, null, 2),
        JSON.stringify(inputData.edges, null, 2)
      ),
    });
    console.log(
      `[duolearno]   Clusters: ${object.clusters.length}, learning order: ${object.suggested_learning_order.length} steps`
    );
    return {
      ...inputData,
      suggestedLearningOrder: object.suggested_learning_order,
      clusters: object.clusters,
    };
  },
});

export const generateLearningPathStep = createStep({
  id: "generate-learning-path",
  inputSchema: S5,
  outputSchema: S6,
  execute: async ({ inputData }) => {
    console.log("[duolearno] Step 5: Generating learning path...");

    const orderedClusters = [...inputData.clusters].sort((a, b) => {
      const aIdx = Math.min(
        ...a.item_ids
          .map((id) => inputData.suggestedLearningOrder.indexOf(id))
          .filter((i) => i >= 0)
      );
      const bIdx = Math.min(
        ...b.item_ids
          .map((id) => inputData.suggestedLearningOrder.indexOf(id))
          .filter((i) => i >= 0)
      );
      return aIdx - bIdx;
    });

    const trimmedItems = inputData.items.map(({ id, label, type, difficulty_estimate, description }) => ({
      id,
      label,
      type,
      difficulty_estimate,
      description,
    }));

    const { object } = await generateObject({
      model: gemini,
      schema: Phase5OutputSchema,
      system: AGENT_SYSTEM_PROMPT,
      prompt: buildPhase5Prompt(
        JSON.stringify(inputData.documentMetadata, null, 2),
        JSON.stringify(trimmedItems, null, 2),
        JSON.stringify(orderedClusters, null, 2),
        JSON.stringify(inputData.suggestedLearningOrder, null, 2),
        JSON.stringify(inputData.prerequisitesAssumed, null, 2),
        inputData.fromLevel,
        inputData.toLevel
      ),
    });

    const modules = object.modules.map((m: LearningModule, i: number) => ({
      ...m,
      module_id: `M${i + 1}`,
    }));
    const total_estimated_minutes = modules.reduce(
      (s: number, m: LearningModule) => s + m.estimated_minutes,
      0
    );
    console.log(`[duolearno]   Modules: ${modules.length}, total: ${total_estimated_minutes} min`);

    return { ...inputData, learningPath: { ...object, modules, total_estimated_minutes } };
  },
});

function formatPlanSummary(data: {
  documentMetadata: { title: string; domain: string; sub_domain: string; proficiency_band: string };
  learningPath: {
    from_level: string;
    to_level: string;
    total_estimated_minutes: number;
    modules: Array<{ module_id: string; title: string; estimated_minutes: number; is_milestone: boolean; learning_objectives: string[] }>;
  };
  prerequisitesAssumed: Array<{ label: string }>;
}): string {
  const { documentMetadata: meta, learningPath: lp, prerequisitesAssumed } = data;
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

  if (prerequisitesAssumed.length > 0) {
    const labels = prerequisitesAssumed.slice(0, 5).map((p) => p.label).join(", ");
    const more = prerequisitesAssumed.length > 5 ? ` (+${prerequisitesAssumed.length - 5} more)` : "";
    lines.push("", `  Prerequisites assumed: ${labels}${more}`);
  }

  lines.push("", hr, "");
  return lines.join("\n");
}

export const humanApprovalStep = createStep({
  id: "human-approval",
  inputSchema: S6,
  outputSchema: AnalyzeOutputSchema,
  suspendSchema: z.object({ summary: z.string() }),
  resumeSchema: z.object({ answer: z.string() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { answer } = resumeData ?? {};

    if (!answer) {
      const summary = formatPlanSummary({
        documentMetadata: inputData.documentMetadata,
        learningPath: inputData.learningPath,
        prerequisitesAssumed: inputData.prerequisitesAssumed,
      });
      return suspend({ summary });
    }

    const normalized = answer.trim().toLowerCase();
    const approved = ["y", "yes", "approve", "ok"].includes(normalized);

    if (approved) {
      console.log("[duolearno] Plan approved.");
      return {
        approvalStatus: "approved" as const,
        userFeedback: "",
        finalOutput: {
          document_metadata: inputData.documentMetadata,
          items: inputData.items,
          prerequisites_assumed: inputData.prerequisitesAssumed,
          edges: inputData.edges,
          boundary_references: inputData.boundaryReferences,
          suggested_learning_order: inputData.suggestedLearningOrder,
          clusters: inputData.clusters,
        },
        learningPath: inputData.learningPath,
        errors: [],
      };
    }

    console.log("[duolearno] Plan rejected.");
    return {
      approvalStatus: "rejected" as const,
      userFeedback: answer.trim(),
      finalOutput: null,
      learningPath: null,
      errors: [],
    };
  },
});
