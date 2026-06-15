import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { mastra } from "@/src/mastra";

export const runtime = "nodejs";

// Streams the analyze workflow's progress to the client as Server-Sent Events so
// the UI can show real per-step completion. Events:
//   event: step       data: { id, status }   // status: "start" | "success" | …
//   event: suspended  data: { runId, summary } // human-approval reached
//   event: error      data: { message }
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("pdf") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpPath = join(tmpdir(), `duolearno-${randomUUID()}.pdf`);
  writeFileSync(tmpPath, buffer);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        const workflow = mastra.getWorkflow("analyzeWorkflow");
        const run = await workflow.createRun();

        // Subscribe to step events via watch(), but drive the run with the plain
        // start() path. (Using stream() leaves a stream controller attached to
        // the run that Mastra double-closes when the run is later resumed —
        // "Controller is already closed". watch() + start() avoids that.)
        const unwatch = run.watch((ev) => {
          if (ev.type === "workflow-step-start") {
            send("step", { id: ev.payload.id, status: "start" });
          } else if (ev.type === "workflow-step-result") {
            send("step", { id: ev.payload.id, status: ev.payload.status });
          }
        });

        let result;
        try {
          result = await run.start({
            inputData: { pdfPath: tmpPath, fromLevel: "", toLevel: "" },
          });
        } finally {
          unwatch();
        }

        if (result.status === "suspended") {
          const stepPayload = (result.suspendPayload as Record<string, { summary?: string }>)?.[
            "human-approval"
          ];
          send("suspended", { runId: run.runId, summary: stepPayload?.summary ?? "" });
        } else {
          send("error", { message: `Unexpected workflow status: ${result.status}` });
        }
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
