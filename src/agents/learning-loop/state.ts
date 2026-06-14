import { Annotation } from "@langchain/langgraph";
import type { LearningPath, DocumentMetadata, Item } from "../../types/prerequisite-graph";
import type { MCQ, ModuleResult, QuestionResult } from "../../types/learning-loop";

export const LearningLoopStateAnnotation = Annotation.Root({
  learningPath: Annotation<LearningPath | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  items: Annotation<Item[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  documentMetadata: Annotation<DocumentMetadata | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  currentModuleIndex: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  currentQuestionIndex: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  currentMcqs: Annotation<MCQ[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // Accumulates results for the module currently in progress
  currentModuleQuestionResults: Annotation<QuestionResult[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // Finalized results appended when each module completes
  moduleResults: Annotation<ModuleResult[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  // Answer captured from interrupt, consumed by evaluate_answer
  pendingAnswer: Annotation<string>({
    reducer: (_, b) => b,
    default: () => "",
  }),

  // Routing signal set by evaluate_answer
  nextAction: Annotation<"next_question" | "next_module" | "done">({
    reducer: (_, b) => b,
    default: () => "next_question",
  }),

  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type LearningLoopState = typeof LearningLoopStateAnnotation.State;
