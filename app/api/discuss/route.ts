import { NextRequest, NextResponse } from "next/server";
import { quizSessions } from "@/src/store/server-store";
import { generateDiscussion, type DiscussionTurn } from "@/src/agents/learn/steps";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId: string;
    moduleTitle?: string;
    question: string;
    options: string[];
    correct_index: number;
    messages: DiscussionTurn[];
  };

  const { sessionId, moduleTitle, question, options, correct_index, messages } = body;

  if (
    !question ||
    !Array.isArray(options) ||
    typeof correct_index !== "number" ||
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const session = await quizSessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found. The quiz data may have expired." }, { status: 404 });
  }

  // Locate the module so the reply can be grounded in its graph neighbourhood.
  const module = session.learningPath.modules.find((m) => m.title === moduleTitle);

  try {
    const reply = await generateDiscussion({
      question,
      options,
      correctIndex: correct_index,
      module,
      items: session.items,
      edges: session.edges,
      assumedPrerequisites: session.assumedPrerequisites,
      messages,
    });
    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
