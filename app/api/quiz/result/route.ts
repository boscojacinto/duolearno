import { NextRequest, NextResponse } from "next/server";
import { quizSessions } from "@/src/store/server-store";
import {
  createQuizSession,
  recordQuestionResult,
  markSessionComplete,
} from "@/src/store/records-store";

// Records one answered question from the web quiz into Postgres. Called by
// MCQCard once a question is concluded (answered correctly, possibly after
// retries). Failures are reported but never surfaced to the learner — recording
// is best-effort and must not interrupt the quiz.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId: string;
    moduleTitle?: string;
    questionIndex: number;
    total?: number;
    question: string;
    options: string[];
    correct_index: number;
    userAnswerIndex: number;
    wrongAttempts?: number;
    wrongOptionIndices?: number[];
    hintsUsed?: number;
    isLastModule?: boolean;
  };

  const { sessionId, question, options, correct_index, userAnswerIndex } = body;

  if (!sessionId || !question || !Array.isArray(options) || typeof correct_index !== "number") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Resolve the module id from the session's learning path (the client only
    // knows the module title). Also ensures a session row exists in case the
    // analyze/resume persistence had failed.
    const session = await quizSessions.get(sessionId);
    const module = session?.learningPath.modules.find((m) => m.title === body.moduleTitle);
    await createQuizSession({
      id: sessionId,
      analysisId: session?.analysisId,
      title: session?.learningPath.title,
      source: "web",
    });

    const wrongAttempts = body.wrongAttempts ?? 0;
    await recordQuestionResult({
      sessionId,
      moduleId: module?.module_id ?? null,
      moduleTitle: body.moduleTitle ?? null,
      questionIndex: body.questionIndex,
      question,
      options,
      correctIndex: correct_index,
      userAnswerIndex,
      isCorrect: wrongAttempts === 0,
      wrongAttempts,
      wrongOptionIndices: body.wrongOptionIndices ?? [],
      hintsUsed: body.hintsUsed ?? 0,
    });

    // Mark the session complete on the last question of the last module.
    if (body.isLastModule && typeof body.total === "number" && body.questionIndex >= body.total - 1) {
      await markSessionComplete(sessionId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[duolearno] Failed to record quiz result:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
