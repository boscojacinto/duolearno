import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { analyzeRuns, quizSessions } from "@/src/store/server-store";
import type { AnalyzeOutputSchema } from "@/src/agents/analyze/steps";
import type { z } from "zod";

export async function POST(request: NextRequest) {
  const { runId, approved } = (await request.json()) as { runId: string; approved: boolean };

  const entry = analyzeRuns.get(runId);
  if (!entry) {
    return NextResponse.json({ error: "Run not found or already resumed" }, { status: 404 });
  }
  analyzeRuns.delete(runId);

  try {
    const result = await entry.run.resume({
      step: "human-approval",
      resumeData: { answer: approved ? "y" : "n" },
    });

    const typedResult = result as { status: string; result?: z.infer<typeof AnalyzeOutputSchema> };

    if (typedResult.status !== "success" || !typedResult.result) {
      return NextResponse.json({ error: "Workflow did not complete successfully" }, { status: 500 });
    }

    const output = typedResult.result;

    if (output.approvalStatus === "rejected") {
      return NextResponse.json({ rejected: true });
    }

    if (!output.finalOutput || !output.learningPath) {
      return NextResponse.json({ error: "Missing output data" }, { status: 500 });
    }

    const sessionId = randomUUID();
    quizSessions.set(sessionId, {
      items: output.finalOutput.items,
      documentMetadata: output.finalOutput.document_metadata,
      edges: output.finalOutput.edges,
      assumedPrerequisites: output.finalOutput.prerequisites_assumed,
      learningPath: output.learningPath,
    });

    return NextResponse.json({
      sessionId,
      learningPath: output.learningPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
