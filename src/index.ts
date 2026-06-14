import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Command } from "commander";
import { Command as LangGraphCommand } from "@langchain/langgraph";
import { buildPrerequisiteGraphAgent } from "./agents/prerequisite-graph/graph";

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function drainStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) { /* consume */ }
}

const program = new Command();

program
  .name("duolearno")
  .description("AI learning agent that transforms PDFs into interactive lessons")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze a PDF and generate a prerequisite graph with learning path")
  .requiredOption("--pdf <path>", "Path to the PDF file")
  .option("--output <path>", "Output JSON file path", "prerequisite-graph.json")
  .option("--pretty", "Pretty-print JSON output", false)
  .option("--from <level>", "Override learner starting level (free text)")
  .option("--to <level>", "Override learner target level (free text)")
  .option("--no-hitl", "Skip the human approval step and write output immediately")
  .action(async (options: { pdf: string; output: string; pretty: boolean; from?: string; to?: string; hitl: boolean }) => {
    if (!process.env.GEMINI_API_KEY) {
      console.error("Error: GEMINI_API_KEY environment variable is not set.");
      console.error("Copy .env.example to .env and add your key.");
      process.exit(1);
    }

    const pdfPath = path.resolve(options.pdf);
    const outputPath = path.resolve(options.output);

    if (!fs.existsSync(pdfPath)) {
      console.error(`Error: PDF not found at ${pdfPath}`);
      process.exit(1);
    }

    console.log(`[duolearno] Analyzing: ${path.basename(pdfPath)}`);
    const start = Date.now();

    const agent = buildPrerequisiteGraphAgent();
    const threadId = `session-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    // Run Phase 1–5; the graph pauses at human_approval via interrupt()
    await drainStream(
      await agent.stream(
        { pdfPath, fromLevel: options.from ?? "", toLevel: options.to ?? "" },
        { ...config, streamMode: "updates" }
      )
    );

    // Check for a pending interrupt from the human_approval node
    const snap = await agent.getState(config);
    type TaskWithInterrupts = { interrupts?: Array<{ value: unknown }> };
    const pendingInterrupts = (snap.tasks as TaskWithInterrupts[])
      .flatMap((t) => t.interrupts ?? []);

    if (pendingInterrupts.length > 0) {
      const answer = options.hitl
        ? await (async () => {
            const planSummary = pendingInterrupts[0].value as string;
            process.stdout.write(planSummary);
            return promptUser("  Approve this plan? [y/n]: ");
          })()
        : "yes";

      // Resume the graph with the user's answer (or auto-approve)
      await drainStream(
        await agent.stream(new LangGraphCommand({ resume: answer }), {
          ...config,
          streamMode: "updates",
        })
      );
    }

    // Read the completed state
    const finalSnap = await agent.getState(config);
    const result = finalSnap.values as {
      errors: string[];
      approvalStatus: "pending" | "approved" | "rejected";
      userFeedback: string;
      finalOutput: { items: unknown[]; edges: unknown[]; clusters: unknown[] } | null;
      learningPath: { modules: unknown[]; total_estimated_minutes: number } | null;
    };

    if (result.errors.length > 0) {
      console.warn("[duolearno] Warnings:", result.errors);
    }

    if (result.approvalStatus === "rejected") {
      console.log("\n[duolearno] Plan rejected — no output written.");
      if (result.userFeedback) console.log(`  Feedback: ${result.userFeedback}`);
      process.exit(0);
    }

    if (!result.finalOutput) {
      console.error("[duolearno] Error: No output was generated.");
      process.exit(1);
    }

    const fullOutput = { ...result.finalOutput, learning_path: result.learningPath };

    const json = options.pretty
      ? JSON.stringify(fullOutput, null, 2)
      : JSON.stringify(fullOutput);

    fs.writeFileSync(outputPath, json, "utf-8");

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n[duolearno] Done in ${elapsed}s`);
    console.log(`  Items extracted  : ${result.finalOutput.items.length}`);
    console.log(`  Prerequisite edges: ${result.finalOutput.edges.length}`);
    console.log(`  Clusters         : ${result.finalOutput.clusters.length}`);
    if (result.learningPath) {
      console.log(`  Learning modules : ${result.learningPath.modules.length}`);
      console.log(`  Total study time : ${result.learningPath.total_estimated_minutes} min`);
    }
    console.log(`  Output           : ${outputPath}`);
  });

program.parse(process.argv);
