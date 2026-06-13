import { Annotation } from "@langchain/langgraph";
import type {
  DocumentMetadata,
  Item,
  AssumedPrerequisite,
  Edge,
  BoundaryReference,
  PrerequisiteGraph,
} from "../../types/prerequisite-graph";

export const GraphStateAnnotation = Annotation.Root({
  pdfPath: Annotation<string>({
    reducer: (_, b) => b,
    default: () => "",
  }),
  extractedText: Annotation<string>({
    reducer: (_, b) => b,
    default: () => "",
  }),
  pageCount: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  pdfTitle: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  pdfAuthor: Annotation<string | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  documentMetadata: Annotation<DocumentMetadata | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  items: Annotation<Item[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  prerequisitesAssumed: Annotation<AssumedPrerequisite[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  edges: Annotation<Edge[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  boundaryReferences: Annotation<BoundaryReference[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  finalOutput: Annotation<PrerequisiteGraph | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type GraphState = typeof GraphStateAnnotation.State;
