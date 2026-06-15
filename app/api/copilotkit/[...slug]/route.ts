import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  defineTool,
} from "@copilotkit/runtime/v2";
import { z } from "zod";
import { LearningModuleSchema } from "@/src/types/prerequisite-graph";
import { generateMcqs, generatePerformanceSummary } from "@/src/agents/learn/steps";
import { quizSessions } from "@/src/store/server-store";
import { getSessionForSummary, saveSessionSummary } from "@/src/store/records-store";

const generateMcqsTool = defineTool({
  name: "generate_mcqs",
  description:
    "Generate multiple-choice questions for a learning module. Call once per module before presenting any questions from it.",
  parameters: z.object({
    sessionId: z.string().describe("The quiz session ID from context"),
    module: LearningModuleSchema,
  }),
  execute: async ({ sessionId, module }) => {
    const session = await quizSessions.get(sessionId);
    if (!session) {
      return { error: "Session not found. The quiz data may have expired." };
    }
    try {
      const mcqs = await generateMcqs(module, session.items, session.documentMetadata);
      return { questions: mcqs };
    } catch (err) {
      return { error: `MCQ generation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

const presentSummaryTool = defineTool({
  name: "present_summary",
  description:
    "Generate the learner's personalized performance summary and study tips after all modules are done. Call exactly once, at the very end.",
  parameters: z.object({
    sessionId: z.string().describe("The quiz session ID from context"),
  }),
  execute: async ({ sessionId }) => {
    const data = await getSessionForSummary(sessionId);
    if (!data) {
      return { error: "Session not found. The quiz data may have expired." };
    }
    try {
      // Reuse a previously generated summary if one was already stored.
      if (data.existingSummary) return { summary: data.existingSummary };
      const summary = await generatePerformanceSummary({
        moduleResults: data.moduleResults,
        learningPath: data.learningPath,
        items: data.items,
        edges: data.edges,
        assumedPrerequisites: data.assumedPrerequisites,
      });
      await saveSessionSummary(sessionId, summary);
      return { summary };
    } catch (err) {
      return { error: `Summary generation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

const QUIZ_SYSTEM_PROMPT = `You are a quiz master for DuoLearno, an AI-powered learning app.

When the user says "start", "begin", "let's go", or similar:
1. Read the quiz context (sessionId and learningPath)
2. For EACH module in learningPath.modules (in order):
   a. Call generate_mcqs with the sessionId and the full module object
   b. For EACH question in the returned questions array (index 0 to questions.length-1), call present_question with:
      - question: the question text
      - options: the 4 option strings
      - moduleTitle: the module title
      - questionIndex: the 0-based index of this question
      - total: questions.length
      - correct_index: the correct answer index (0-3)
      - explanation: the explanation string
   c. Track correct answers. After all questions in the module, say: "Module complete: X/Y correct."
3. After ALL modules are done, call present_summary ONCE with the sessionId. Do not write your own summary — the tool renders the performance summary and study tips. After it returns, stop.

Rules:
- Call present_question for EVERY question. Do not skip any.
- Wait for each present_question call to complete before calling the next.
- Do not reveal the correct_index or explanation to the user before they submit.
- Call present_summary exactly once, only after every module is complete.`;

const runtime = new CopilotRuntime({
  agents: () => ({
    default: new BuiltInAgent({
      model: "google/gemini-3.1-flash-lite",
      apiKey: process.env.GEMINI_API_KEY,
      prompt: QUIZ_SYSTEM_PROMPT,
      tools: [generateMcqsTool, presentSummaryTool],
      maxSteps: 50,
    }),
  }),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
