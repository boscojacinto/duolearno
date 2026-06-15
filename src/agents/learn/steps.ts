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
  PerformanceTipsSchema,
} from "../../types/learning-loop";
import type {
  MCQ,
  MCQSet,
  QuestionResult,
  ModuleResult,
  PerformanceTips,
  PerformanceSummary,
} from "../../types/learning-loop";
import type {
  LearningPath,
  LearningModule,
  Item,
  Edge,
  AssumedPrerequisite,
  DocumentMetadata,
} from "../../types/prerequisite-graph";
import {
  MCQ_SYSTEM_PROMPT,
  buildMCQPrompt,
  HINT_SYSTEM_PROMPT,
  buildHintPrompt,
  DISCUSS_SYSTEM_PROMPT,
  buildDiscussContext,
  PERFORMANCE_SUMMARY_SYSTEM_PROMPT,
  buildPerformanceSummaryPrompt,
} from "./prompts";

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

export interface PrerequisiteConcept {
  id: string;
  label: string;
  description: string;
  assumed: boolean;
}

/**
 * Resolve the prerequisite concepts a set of module concepts builds on. An edge
 * A → B means A must be understood before B, so the prerequisites of the module's
 * concepts are the `from` ends of edges that point into them from outside the
 * module. Each id is resolved to a real item, or to an assumed prerequisite.
 * Shared by the hint generator and the performance-summary generator.
 */
export function resolvePrerequisiteConcepts(
  moduleItemIds: Iterable<string>,
  items: Item[],
  edges: Edge[],
  assumedPrerequisites: AssumedPrerequisite[] = []
): PrerequisiteConcept[] {
  const idSet = new Set(moduleItemIds);
  const prereqIds = new Set<string>();
  for (const edge of edges) {
    if (idSet.has(edge.to) && !idSet.has(edge.from)) prereqIds.add(edge.from);
  }
  const itemById = new Map(items.map((it) => [it.id, it] as const));
  const assumedById = new Map(assumedPrerequisites.map((a) => [a.id, a] as const));
  const out: PrerequisiteConcept[] = [];
  for (const id of prereqIds) {
    const it = itemById.get(id);
    if (it) out.push({ id, label: it.label, description: it.description, assumed: false });
    else {
      const a = assumedById.get(id);
      if (a) out.push({ id, label: a.label, description: a.description, assumed: true });
    }
  }
  return out;
}

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

  const prereqLines = resolvePrerequisiteConcepts(moduleItemIds, items, edges, assumedPrerequisites).map(
    (p) => `- ${p.label}${p.assumed ? " (assumed)" : ""}: ${p.description}`
  );

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

// ── Graph-grounded discussion (free-form tutoring after a wrong answer) ───────

export interface DiscussionTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Continue a free-form tutoring conversation about a wrongly-answered question.
 * Grounded in the same prerequisite graph as hints, but multi-turn: the running
 * chat is passed as `messages`. The tutor explains the topic and answers
 * questions without ever revealing the correct option, always steering the
 * learner back to attempting the question.
 */
export async function generateDiscussion(params: {
  question: string;
  options: string[];
  correctIndex: number;
  module: LearningModule | undefined;
  items: Item[];
  edges: Edge[];
  assumedPrerequisites?: AssumedPrerequisite[];
  messages: DiscussionTurn[];
}): Promise<string> {
  const { question, options, correctIndex, module, items, edges, assumedPrerequisites = [], messages } = params;

  const moduleItemIds = new Set(module?.item_ids ?? []);
  const testedItems = items.filter((it) => moduleItemIds.has(it.id));

  const prereqLines = resolvePrerequisiteConcepts(moduleItemIds, items, edges, assumedPrerequisites).map(
    (p) => `- ${p.label}${p.assumed ? " (assumed)" : ""}: ${p.description}`
  );

  const testedConcepts = testedItems.map((it) => `- [${it.type}] ${it.label}: ${it.description}`).join("\n");
  const optionsLabeled = options.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n");

  // Question/concept context lives in the system prompt; the running chat is
  // passed as conversation turns so the tutor can hold a coherent thread.
  const context = buildDiscussContext({
    question,
    optionsLabeled,
    moduleTitle: module?.title ?? "this module",
    testedConcepts,
    prerequisiteConcepts: prereqLines.join("\n"),
    correctLabel: LETTERS[correctIndex] ?? "?",
  });

  const { text } = await generateText({
    model: gemini,
    system: `${DISCUSS_SYSTEM_PROMPT}\n\n${context}`,
    messages,
  });

  return text.trim();
}

// ── Performance summary + study tips (Phase 4) ───────────────────────────────

const FOCUS_THRESHOLD_PCT = 80;

/**
 * Build a personalized performance summary from a completed quiz's results.
 * Scores are computed deterministically here; for modules below the focus
 * threshold the prerequisite concepts are resolved from the analysis graph (same
 * grounding as hints) and the LLM writes the prose, leaning on those concepts.
 */
export async function generatePerformanceSummary(params: {
  moduleResults: ModuleResult[];
  learningPath: LearningPath;
  items: Item[];
  edges: Edge[];
  assumedPrerequisites?: AssumedPrerequisite[];
}): Promise<PerformanceSummary> {
  const { moduleResults, learningPath, items, edges, assumedPrerequisites = [] } = params;

  const totalQuestions = moduleResults.reduce((s, m) => s + m.total_questions, 0);
  const correctAnswers = moduleResults.reduce((s, m) => s + m.correct_answers, 0);
  const accuracyPct = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

  const pct = (m: ModuleResult) =>
    m.total_questions > 0 ? Math.round((m.correct_answers / m.total_questions) * 100) : 0;

  const moduleById = new Map(learningPath.modules.map((m) => [m.module_id, m] as const));

  // Weak modules + their graph-resolved prerequisite concepts.
  const focusAreas = moduleResults
    .filter((m) => pct(m) < FOCUS_THRESHOLD_PCT)
    .map((m) => {
      const mod = moduleById.get(m.module_id);
      const prereqs = mod
        ? resolvePrerequisiteConcepts(mod.item_ids, items, edges, assumedPrerequisites)
        : [];
      return { moduleResult: m, scorePct: pct(m), prerequisites: prereqs };
    });

  const { object } = await generateObject({
    model: gemini,
    schema: PerformanceTipsSchema,
    system: PERFORMANCE_SUMMARY_SYSTEM_PROMPT,
    prompt: buildPerformanceSummaryPrompt({
      pathTitle: learningPath.title,
      fromLevel: learningPath.from_level,
      toLevel: learningPath.to_level,
      accuracyPct,
      totalQuestions,
      correctAnswers,
      moduleScores: moduleResults.map((m) => ({
        title: m.module_title,
        scorePct: pct(m),
        correct: m.correct_answers,
        total: m.total_questions,
      })),
      focusAreas: focusAreas.map((f) => ({
        title: f.moduleResult.module_title,
        scorePct: f.scorePct,
        prerequisites: f.prerequisites.map((p) => ({
          label: p.label,
          description: p.description,
          assumed: p.assumed,
        })),
      })),
    }),
  });

  const tips = object as PerformanceTips;
  const tipByModule = new Map(tips.focus_area_tips.map((t) => [t.module_title, t.tip] as const));
  const prereqByModule = new Map(
    focusAreas.map((f) => [f.moduleResult.module_title, f.prerequisites.map((p) => p.label)] as const)
  );

  // Full per-module breakdown — every module is listed so the correct/total
  // counts sum to the overall score; weak modules also carry a tip + the
  // prerequisite concepts to revisit.
  return {
    headline: tips.headline,
    accuracy_pct: accuracyPct,
    total_questions: totalQuestions,
    correct_answers: correctAnswers,
    strengths: tips.strengths,
    focus_areas: moduleResults.map((m) => ({
      module_title: m.module_title,
      score_pct: pct(m),
      correct_answers: m.correct_answers,
      total_questions: m.total_questions,
      prerequisite_concepts: prereqByModule.get(m.module_title) ?? [],
      tip: tipByModule.get(m.module_title) ?? "",
    })),
    study_tips: tips.study_tips,
    next_steps: tips.next_steps,
  };
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
