import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mastra } from "@/src/mastra";
import { quizSessions } from "@/src/store/server-store";
import { saveAnalysis, createQuizSession } from "@/src/store/records-store";
import type { AnalyzeOutputSchema } from "@/src/agents/analyze/steps";
import type { z } from "zod";

export async function POST(request: NextRequest) {
  const { runId, approved } = (await request.json()) as { runId: string; approved: boolean };

  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  try {
    // Rehydrate the suspended run from Redis (Mastra storage) and resume it —
    // works across restarts / instances, no in-memory handle required.
    const run = await mastra.getWorkflow("analyzeWorkflow").createRun({ runId });
    const result = await run.resume({
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

    // Persist the analysis and open a quiz session in Postgres (the durable
    // system of record). Best-effort: a DB hiccup must not block the quiz, which
    // runs off the Redis session below.
    let analysisId: string | undefined;
    try {
      analysisId = await saveAnalysis({
        documentMetadata: output.finalOutput.document_metadata,
        items: output.finalOutput.items,
        edges: output.finalOutput.edges,
        assumedPrerequisites: output.finalOutput.prerequisites_assumed,
        clusters: output.finalOutput.clusters,
        learningPath: output.learningPath,
      });
      await createQuizSession({
        id: sessionId,
        analysisId,
        title: output.learningPath.title,
        source: "web",
      });
    } catch (dbErr) {
      console.error("[duolearno] Failed to persist analysis/session:", dbErr);
    }

    await quizSessions.set(sessionId, {
      items: output.finalOutput.items,
      documentMetadata: output.finalOutput.document_metadata,
      edges: output.finalOutput.edges,
      assumedPrerequisites: output.finalOutput.prerequisites_assumed,
      learningPath: output.learningPath,
      analysisId,
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
