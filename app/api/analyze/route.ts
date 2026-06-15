import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { mastra } from "@/src/mastra";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("pdf") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpPath = join(tmpdir(), `duolearno-${randomUUID()}.pdf`);
  writeFileSync(tmpPath, buffer);

  try {
    const workflow = mastra.getWorkflow("analyzeWorkflow");
    const run = await workflow.createRun();

    const result = await run.start({
      inputData: {
        pdfPath: tmpPath,
        fromLevel: "",
        toLevel: "",
      },
    });

    // PDF has been read by the first step; safe to remove the temp file now
    if (existsSync(tmpPath)) unlinkSync(tmpPath);

    if (result.status === "suspended") {
      // The run snapshot is persisted to Redis by Mastra storage; resume later
      // by its runId (no in-memory handle needed).
      // suspendPayload is keyed by step ID: { "human-approval": { summary } }
      const stepPayload = (result.suspendPayload as Record<string, { summary?: string }>)["human-approval"];
      const summary = stepPayload?.summary ?? "";
      return NextResponse.json({ runId: run.runId, summary });
    }

    return NextResponse.json({ error: "Unexpected workflow status: " + result.status }, { status: 500 });
  } catch (err) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
