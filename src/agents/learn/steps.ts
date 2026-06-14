import { createStep } from "@mastra/core/workflows";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import {
  LearningPathSchema,
  ItemSchema,
  DocumentMetadataSchema,
} from "../../types/prerequisite-graph";
import {
  MCQSchema,
  MCQSetSchema,
  QuestionResultSchema,
  ModuleResultSchema,
} from "../../types/learning-loop";
import type { MCQ, MCQSet, QuestionResult, ModuleResult } from "../../types/learning-loop";
import type {
  LearningPath,
  LearningModule,
  Item,
  Edge,
  AssumedPrerequisite,
  DocumentMetadata,
} from "../../types/prerequisite-graph";
import { MCQ_SYSTEM_PROMPT, buildMCQPrompt, HINT_SYSTEM_PROMPT, buildHintPrompt } from "./prompts";

const googleAI = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
const gemini = googleAI("gemini-3.1-flash-lite");

const LABELS = ["A", "B", "C", "D"];

// ── Shared state schema for the quiz loop ────────────────────────────────────

export const QuizStateSchema = z.object({
  learningPath: LearningPathSchema.nullable(),
  items: z.array(ItemSchema),
  documentMetadata: DocumentMetadataSchema.nullable(),
  currentModuleIndex: z.number(),
  currentQuestionIndex: z.number(),
  currentMcqs: z.array(MCQSchema),
  currentModuleQuestionResults: z.array(QuestionResultSchema),
  moduleResults: z.array(ModuleResultSchema),
});

export type QuizState = z.infer<typeof QuizStateSchema>;

// Mastra validates the initial workflow state against QuizStateSchema at
// run.start(); supply a fully-populated empty state so validation passes. The
// `init-quiz` step immediately overwrites these with real values from inputData.
export const EMPTY_QUIZ_STATE: QuizState = {
  learningPath: null,
  items: [],
  documentMetadata: null,
  currentModuleIndex: 0,
  currentQuestionIndex: 0,
  currentMcqs: [],
  currentModuleQuestionResults: [],
  moduleResults: [],
};

// ── I/O schemas ──────────────────────────────────────────────────────────────

export const LearnInputSchema = z.object({
  learningPath: LearningPathSchema,
  items: z.array(ItemSchema),
  documentMetadata: DocumentMetadataSchema,
});

const LoopTickSchema = z.object({ done: z.boolean() });

export const LearnOutputSchema = z.object({
  moduleResults: z.array(ModuleResultSchema),
  learningPath: LearningPathSchema,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatQuestion(mcq: MCQ, index: number, total: number, moduleTitle: string): string {
  const hr = "─".repeat(58);
  const header = `  ${moduleTitle}  [Question ${index + 1} / ${total}]`;
  return [
    "",
    hr,
    header,
    hr,
    "",
    `  ${mcq.question}`,
    "",
    ...mcq.options.map((opt, i) => `    ${LABELS[i]}) ${opt}`),
    "",
  ].join("\n");
}

export async function generateMcqs(
  module: LearningPath["modules"][number],
  items: Item[],
  documentMetadata: DocumentMetadata
): Promise<MCQ[]> {
  const moduleItems = items.filter((item) => module.item_ids.includes(item.id));
  const itemDescriptions =
    moduleItems.length > 0
      ? moduleItems.map((item) => `- [${item.type}] ${item.label}: ${item.description}`).join("\n")
      : "(general module concepts)";

  const docContext = `Domain: ${documentMetadata.domain} › ${documentMetadata.sub_domain} (${documentMetadata.proficiency_band})`;
  const questionCount = Math.max(3, Math.min(module.learning_objectives.length + 1, 6));

  const { object } = await generateObject({
    model: gemini,
    schema: MCQSetSchema,
    system: MCQ_SYSTEM_PROMPT,
    prompt: buildMCQPrompt(
      module.title,
      module.learning_objectives,
      itemDescriptions,
      docContext,
      questionCount
    ),
  });

  return (object as MCQSet).questions;
}

// ── Graph-grounded hint generation (learn phase) ─────────────────────────────

const LETTERS = ["A", "B", "C", "D"];

/**
 * Generate the next hint for a wrongly-answered question. Hints are built on the
 * prerequisite graph from the analyze phase: the question's module concepts and
 * the concepts they depend on (resolved via prerequisite edges) are fed to the
 * model so each hint leans on foundations the learner should already know —
 * without ever revealing the answer.
 */
export async function generateHint(params: {
  question: string;
  options: string[];
  correctIndex: number;
  module: LearningModule | undefined;
  items: Item[];
  edges: Edge[];
  assumedPrerequisites?: AssumedPrerequisite[];
  previousHints?: string[];
}): Promise<string> {
  const { question, options, correctIndex, module, items, edges, assumedPrerequisites = [], previousHints = [] } = params;

  // Concepts this question's module covers.
  const moduleItemIds = new Set(module?.item_ids ?? []);
  const testedItems = items.filter((it) => moduleItemIds.has(it.id));

  // Prerequisites: an edge A → B means A must be understood before B, so the
  // prerequisites of a tested concept are the `from` ends of edges into it.
  const prereqIds = new Set<string>();
  for (const edge of edges) {
    if (moduleItemIds.has(edge.to) && !moduleItemIds.has(edge.from)) prereqIds.add(edge.from);
  }
  const itemById = new Map(items.map((it) => [it.id, it] as const));
  const assumedById = new Map(assumedPrerequisites.map((a) => [a.id, a] as const));
  const prereqLines: string[] = [];
  for (const id of prereqIds) {
    const it = itemById.get(id);
    if (it) prereqLines.push(`- ${it.label}: ${it.description}`);
    else {
      const a = assumedById.get(id);
      if (a) prereqLines.push(`- ${a.label} (assumed): ${a.description}`);
    }
  }

  const testedConcepts = testedItems.map((it) => `- [${it.type}] ${it.label}: ${it.description}`).join("\n");
  const optionsLabeled = options.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n");

  const { text } = await generateText({
    model: gemini,
    system: HINT_SYSTEM_PROMPT,
    prompt: buildHintPrompt({
      question,
      optionsLabeled,
      moduleTitle: module?.title ?? "this module",
      testedConcepts,
      prerequisiteConcepts: prereqLines.join("\n"),
      correctLabel: LETTERS[correctIndex] ?? "?",
      previousHints,
    }),
  });

  return text.trim();
}

// ── Steps ────────────────────────────────────────────────────────────────────

export const initQuizStep = createStep({
  id: "init-quiz",
  inputSchema: LearnInputSchema,
  outputSchema: LoopTickSchema,
  stateSchema: QuizStateSchema,
  execute: async ({ inputData, setState }) => {
    await setState({
      learningPath: inputData.learningPath,
      items: inputData.items,
      documentMetadata: inputData.documentMetadata,
      currentModuleIndex: 0,
      currentQuestionIndex: 0,
      currentMcqs: [],
      currentModuleQuestionResults: [],
      moduleResults: [],
    });
    return { done: false };
  },
});

export const quizStep = createStep({
  id: "quiz",
  inputSchema: LoopTickSchema,
  outputSchema: LoopTickSchema,
  stateSchema: QuizStateSchema,
  suspendSchema: z.object({ questionText: z.string() }),
  resumeSchema: z.object({ answer: z.string() }),
  execute: async ({ resumeData, suspend, state, setState }) => {
    const lp = state.learningPath!;
    const { items, documentMetadata, currentModuleIndex, currentQuestionIndex } = state;

    // ── Resume branch: evaluate submitted answer ─────────────────────────────
    if (resumeData) {
      const mcq = state.currentMcqs[currentQuestionIndex];
      const answerIndex = LABELS.indexOf(resumeData.answer.trim().toUpperCase());
      const isCorrect = answerIndex !== -1 && answerIndex === mcq.correct_index;

      const correctLabel = LABELS[mcq.correct_index];
      const correctText = mcq.options[mcq.correct_index];

      if (answerIndex === -1) {
        console.log(`\n  Invalid input — expected A, B, C, or D.`);
        console.log(`  Correct answer: ${correctLabel}) ${correctText}`);
      } else if (isCorrect) {
        console.log(`\n  ✓ Correct!`);
      } else {
        console.log(`\n  ✗ Incorrect. You chose: ${LABELS[answerIndex]}) ${mcq.options[answerIndex]}`);
        console.log(`    Correct answer: ${correctLabel}) ${correctText}`);
      }
      console.log(`    ${mcq.explanation}`);

      const questionResult: QuestionResult = {
        question: mcq.question,
        user_answer_index: answerIndex >= 0 ? answerIndex : -1,
        correct_index: mcq.correct_index,
        is_correct: isCorrect,
      };

      const updatedResults = [...state.currentModuleQuestionResults, questionResult];
      const isLastQuestion = currentQuestionIndex >= state.currentMcqs.length - 1;

      if (!isLastQuestion) {
        await setState({
          ...state,
          currentModuleQuestionResults: updatedResults,
          currentQuestionIndex: currentQuestionIndex + 1,
        });
        return { done: false };
      }

      // Module complete — finalize
      const totalCorrect = updatedResults.filter((r) => r.is_correct).length;
      const total = updatedResults.length;
      const pct = Math.round((totalCorrect / total) * 100);
      const module = lp.modules[currentModuleIndex];

      const moduleResult: ModuleResult = {
        module_id: module.module_id,
        module_title: module.title,
        total_questions: total,
        correct_answers: totalCorrect,
        question_results: updatedResults,
      };

      const hr = "─".repeat(58);
      console.log(`\n${hr}`);
      console.log(`  Module complete: ${module.title}`);
      console.log(`  Score: ${totalCorrect}/${total} (${pct}%)`);
      console.log(hr);

      const isLastModule = currentModuleIndex >= lp.modules.length - 1;

      if (isLastModule) {
        await setState({
          ...state,
          moduleResults: [...state.moduleResults, moduleResult],
          currentModuleQuestionResults: [],
        });
        return { done: true };
      }

      await setState({
        ...state,
        moduleResults: [...state.moduleResults, moduleResult],
        currentModuleIndex: currentModuleIndex + 1,
        currentQuestionIndex: 0,
        currentMcqs: [],
        currentModuleQuestionResults: [],
      });
      return { done: false };
    }

    // ── First-call branch: present next question ─────────────────────────────
    let mcqs = state.currentMcqs;

    if (mcqs.length === 0) {
      const module = lp.modules[currentModuleIndex];
      console.log(`\n[duolearno] Module ${currentModuleIndex + 1}/${lp.modules.length}: ${module.title}`);
      if (module.is_milestone) {
        console.log(`  ✦ Milestone — ${module.milestone_description}`);
      }
      console.log("[duolearno] Generating questions...");

      mcqs = await generateMcqs(module, items, documentMetadata!);
      console.log(`[duolearno] ${mcqs.length} questions ready.\n`);

      await setState({ ...state, currentMcqs: mcqs });
    }

    const module = lp.modules[currentModuleIndex];
    const mcq = mcqs[state.currentQuestionIndex];
    const questionText = formatQuestion(mcq, state.currentQuestionIndex, mcqs.length, module.title);

    return suspend({ questionText });
  },
});

export const summaryStep = createStep({
  id: "summary",
  inputSchema: LoopTickSchema,
  outputSchema: LearnOutputSchema,
  stateSchema: QuizStateSchema,
  execute: async ({ state }) => {
    return {
      moduleResults: state.moduleResults,
      learningPath: state.learningPath!,
    };
  },
});
