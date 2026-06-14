import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { interrupt } from "@langchain/langgraph";
import { MCQSetSchema } from "../../types/learning-loop";
import type { MCQ, MCQSet, ModuleResult, QuestionResult } from "../../types/learning-loop";
import { toGeminiSchema } from "../../tools/gemini-schema";
import { MCQ_SYSTEM_PROMPT, buildMCQPrompt } from "./prompts";
import type { LearningLoopState } from "./state";

const LABELS = ["A", "B", "C", "D"];

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.4,
  apiKey: process.env.GEMINI_API_KEY,
});

function formatQuestion(mcq: MCQ, index: number, total: number, moduleTitle: string): string {
  const hr = "─".repeat(58);
  const header = `  ${moduleTitle}  [Question ${index + 1} / ${total}]`;
  const lines = [
    "",
    hr,
    header,
    hr,
    "",
    `  ${mcq.question}`,
    "",
    ...mcq.options.map((opt, i) => `    ${LABELS[i]}) ${opt}`),
    "",
  ];
  return lines.join("\n");
}

export async function generateMcqsNode(state: LearningLoopState): Promise<Partial<LearningLoopState>> {
  const { learningPath, items, documentMetadata, currentModuleIndex } = state;
  if (!learningPath || !documentMetadata) {
    return { errors: ["generate_mcqs: missing learningPath or documentMetadata"] };
  }

  const module = learningPath.modules[currentModuleIndex];
  if (!module) {
    return { errors: [`generate_mcqs: no module at index ${currentModuleIndex}`] };
  }

  console.log(`\n[duolearno] Module ${currentModuleIndex + 1}/${learningPath.modules.length}: ${module.title}`);
  if (module.is_milestone) {
    console.log(`  ✦ Milestone — ${module.milestone_description}`);
  }
  console.log("[duolearno] Generating questions...");

  const moduleItems = items.filter((item) => module.item_ids.includes(item.id));
  const itemDescriptions = moduleItems.length > 0
    ? moduleItems.map((item) => `- [${item.type}] ${item.label}: ${item.description}`).join("\n")
    : "(general module concepts)";

  const docContext = `Domain: ${documentMetadata.domain} › ${documentMetadata.sub_domain} (${documentMetadata.proficiency_band})`;
  const questionCount = Math.max(3, Math.min(module.learning_objectives.length + 1, 6));

  const structured = llm.withStructuredOutput(toGeminiSchema(MCQSetSchema), { name: "mcq_set" });
  const result = (await structured.invoke([
    { role: "system", content: MCQ_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildMCQPrompt(
        module.title,
        module.learning_objectives,
        itemDescriptions,
        docContext,
        questionCount,
      ),
    },
  ])) as MCQSet;

  console.log(`[duolearno] ${result.questions.length} questions ready.\n`);

  return {
    currentMcqs: result.questions,
    currentQuestionIndex: 0,
    currentModuleQuestionResults: [],
  };
}

export async function presentQuestionNode(state: LearningLoopState): Promise<Partial<LearningLoopState>> {
  const { learningPath, currentMcqs, currentQuestionIndex, currentModuleIndex } = state;
  if (!learningPath) return { errors: ["present_question: missing learningPath"] };

  const module = learningPath.modules[currentModuleIndex];
  const mcq = currentMcqs[currentQuestionIndex];
  const formatted = formatQuestion(mcq, currentQuestionIndex, currentMcqs.length, module.title);

  const answer = interrupt(formatted) as string;
  return { pendingAnswer: answer.trim().toUpperCase() };
}

export async function evaluateAnswerNode(state: LearningLoopState): Promise<Partial<LearningLoopState>> {
  const {
    learningPath,
    currentMcqs,
    currentQuestionIndex,
    currentModuleIndex,
    currentModuleQuestionResults,
    moduleResults,
    pendingAnswer,
  } = state;
  if (!learningPath) return { errors: ["evaluate_answer: missing learningPath"] };

  const mcq = currentMcqs[currentQuestionIndex];
  const answerIndex = LABELS.indexOf(pendingAnswer ?? "");
  const isCorrect = answerIndex !== -1 && answerIndex === mcq.correct_index;

  const correctLabel = LABELS[mcq.correct_index];
  const correctText = mcq.options[mcq.correct_index];

  if (answerIndex === -1) {
    console.log(`\n  Invalid input — expected A, B, C, or D.`);
    console.log(`  Correct answer: ${correctLabel}) ${correctText}`);
  } else if (isCorrect) {
    console.log(`\n  ✓ Correct!`);
  } else {
    const givenLabel = LABELS[answerIndex];
    console.log(`\n  ✗ Incorrect. You chose: ${givenLabel}) ${mcq.options[answerIndex]}`);
    console.log(`    Correct answer: ${correctLabel}) ${correctText}`);
  }
  console.log(`    ${mcq.explanation}`);

  const questionResult: QuestionResult = {
    question: mcq.question,
    user_answer_index: answerIndex >= 0 ? answerIndex : -1,
    correct_index: mcq.correct_index,
    is_correct: isCorrect,
  };

  const updatedCurrentResults = [...currentModuleQuestionResults, questionResult];
  const isLastQuestion = currentQuestionIndex >= currentMcqs.length - 1;
  const isLastModule = currentModuleIndex >= learningPath.modules.length - 1;

  if (!isLastQuestion) {
    return {
      currentModuleQuestionResults: updatedCurrentResults,
      currentQuestionIndex: currentQuestionIndex + 1,
      pendingAnswer: "",
      nextAction: "next_question",
    };
  }

  // Module complete — finalize result and print summary
  const totalCorrect = updatedCurrentResults.filter((r) => r.is_correct).length;
  const total = updatedCurrentResults.length;
  const pct = Math.round((totalCorrect / total) * 100);
  const module = learningPath.modules[currentModuleIndex];

  const finishedResult: ModuleResult = {
    module_id: module.module_id,
    module_title: module.title,
    total_questions: total,
    correct_answers: totalCorrect,
    question_results: updatedCurrentResults,
  };

  const hr = "─".repeat(58);
  console.log(`\n${hr}`);
  console.log(`  Module complete: ${module.title}`);
  console.log(`  Score: ${totalCorrect}/${total} (${pct}%)`);
  console.log(hr);

  if (isLastModule) {
    return {
      moduleResults: [...moduleResults, finishedResult],
      currentModuleQuestionResults: [],
      pendingAnswer: "",
      nextAction: "done",
    };
  }

  return {
    moduleResults: [...moduleResults, finishedResult],
    currentModuleIndex: currentModuleIndex + 1,
    currentQuestionIndex: 0,
    currentModuleQuestionResults: [],
    pendingAnswer: "",
    nextAction: "next_module",
  };
}

export function routeAfterEvaluate(state: LearningLoopState): string {
  return state.nextAction;
}
