import { z } from "zod";

// ── Shared enums ────────────────────────────────────────────────────────────

export const ItemTypeSchema = z.enum(["concept", "skill", "principle", "vocabulary"]);
export const ProficiencyBandSchema = z.enum(["foundational", "intermediate", "advanced", "expert"]);
export const DependencyTypeSchema = z.enum(["direct", "soft", "co-requisite"]);

// ── Core schemas ─────────────────────────────────────────────────────────────

export const DocumentMetadataSchema = z.object({
  title: z.string(),
  author: z.string().optional(),
  domain: z.string(),
  sub_domain: z.string(),
  proficiency_band: ProficiencyBandSchema,
  adjacent_domains: z.array(z.string()),
  summary: z.string(),
});

export const ItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ItemTypeSchema,
  description: z.string(),
  source_location: z.string(),
  difficulty_estimate: z.number().int().min(1).max(10),
  implicit: z.boolean().default(false),
});

export const AssumedPrerequisiteSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ItemTypeSchema,
  description: z.string(),
  estimated_domain: z.string(),
  estimated_proficiency: ProficiencyBandSchema,
  implicit: z.boolean().default(true),
});

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  dependency_type: DependencyTypeSchema,
  notes: z.string().optional(),
});

export const BoundaryReferenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  mentioned_in: z.string(),
  estimated_domain: z.string(),
});

export const ClusterSchema = z.object({
  cluster_id: z.string(),
  label: z.string(),
  item_ids: z.array(z.string()),
  description: z.string(),
});

// ── Per-phase output schemas ─────────────────────────────────────────────────

export const Phase1OutputSchema = DocumentMetadataSchema;

export const Phase2OutputSchema = z.object({
  items: z.array(ItemSchema),
  prerequisites_assumed: z.array(AssumedPrerequisiteSchema),
});

export const Phase3OutputSchema = z.object({
  edges: z.array(EdgeSchema),
  boundary_references: z.array(BoundaryReferenceSchema),
});

export const Phase4OutputSchema = z.object({
  suggested_learning_order: z.array(z.string()),
  clusters: z.array(ClusterSchema),
});

// ── Full graph output ────────────────────────────────────────────────────────

export const PrerequisiteGraphSchema = z.object({
  document_metadata: DocumentMetadataSchema,
  items: z.array(ItemSchema),
  prerequisites_assumed: z.array(AssumedPrerequisiteSchema),
  edges: z.array(EdgeSchema),
  boundary_references: z.array(BoundaryReferenceSchema),
  suggested_learning_order: z.array(z.string()),
  clusters: z.array(ClusterSchema),
});

// ── TypeScript types ─────────────────────────────────────────────────────────

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type AssumedPrerequisite = z.infer<typeof AssumedPrerequisiteSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type BoundaryReference = z.infer<typeof BoundaryReferenceSchema>;
export type Cluster = z.infer<typeof ClusterSchema>;
export type PrerequisiteGraph = z.infer<typeof PrerequisiteGraphSchema>;
export type Phase1Output = z.infer<typeof Phase1OutputSchema>;
export type Phase2Output = z.infer<typeof Phase2OutputSchema>;
export type Phase3Output = z.infer<typeof Phase3OutputSchema>;
export type Phase4Output = z.infer<typeof Phase4OutputSchema>;
