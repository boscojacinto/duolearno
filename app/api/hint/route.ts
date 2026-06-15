import { NextRequest, NextResponse } from "next/server";
import { quizSessions } from "@/src/store/server-store";
import { generateHint } from "@/src/agents/learn/steps";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId: string;
    moduleTitle?: string;
    question: string;
    options: string[];
    correct_index: number;
    previousHints?: string[];
  };

  const { sessionId, moduleTitle, question, options, correct_index, previousHints = [] } = body;

  if (!question || !Array.isArray(options) || typeof correct_index !== "number") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const session = await quizSessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found. The quiz data may have expired." }, { status: 404 });
  }

  // Locate the module so the hint can be grounded in its graph neighbourhood.
  const module = session.learningPath.modules.find((m) => m.title === moduleTitle);

  try {
    const hint = await generateHint({
      question,
      options,
      correctIndex: correct_index,
      module,
      items: session.items,
      edges: session.edges,
      assumedPrerequisites: session.assumedPrerequisites,
      previousHints,
    });
    return NextResponse.json({ hint });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
