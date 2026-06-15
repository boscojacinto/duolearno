import "./crypto-polyfill";
import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Command } from "commander";
import { mastra } from "./mastra";
import type { z } from "zod";
import type { AnalyzeOutputSchema } from "./agents/analyze/steps";
import type { LearnOutputSchema } from "./agents/learn/steps";
import { EMPTY_QUIZ_STATE, generatePerformanceSummary } from "./agents/learn/steps";
import {
  saveAnalysis,
  createQuizSession,
  saveModuleResults,
  saveSessionSummary,
  analysisExists,
} from "./store/records-store";
import type { ModuleResult, PerformanceSummary } from "./types/learning-loop";
import type {
  LearningPath,
  DocumentMetadata,
  Item,
  Edge,
  AssumedPrerequisite,
} from "./types/prerequisite-graph";

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function printFinalSummary(moduleResults: ModuleResult[], learningPath: LearningPath): void {
  const hr = "═".repeat(58);
  const totalQ = moduleResults.reduce((s, m) => s + m.total_questions, 0);
  const totalC = moduleResults.reduce((s, m) => s + m.correct_answers, 0);
  const pct = totalQ > 0 ? Math.round((totalC / totalQ) * 100) : 0;

  console.log(`\n${hr}`);
  console.log(`  SESSION COMPLETE — ${learningPath.title}`);
  console.log(hr);
  console.log(`\n  Overall score: ${totalC}/${totalQ} (${pct}%)\n`);
  console.log("  Results by module:");
  for (const mod of moduleResults) {
    const modPct = Math.round((mod.correct_answers / mod.total_questions) * 100);
    const bar = modPct >= 80 ? "✓" : modPct >= 50 ? "~" : "✗";
    console.log(
      `    ${bar}  ${mod.module_id}. ${mod.module_title} — ${mod.correct_answers}/${mod.total_questions} (${modPct}%)`
    );
  }

  if (pct >= 80) {
    console.log("\n  Great work! You have a solid grasp of this material.");
  } else if (pct >= 50) {
    console.log("\n  Good effort. Review the modules where you scored below 80%.");
  } else {
    console.log("\n  Keep at it. Re-read the source material and try again.");
  }
  console.log(`\n${hr}\n`);
}

function printPerformanceSummary(summary: PerformanceSummary): void {
  const hr = "═".repeat(58);
  console.log(`${hr}`);
  console.log(`  PERFORMANCE SUMMARY & STUDY TIPS`);
  console.log(hr);
  console.log(`\n  ${summary.headline}`);
  console.log(`  Accuracy: ${summary.correct_answers}/${summary.total_questions} (${summary.accuracy_pct}%)`);

  if (summary.strengths.length > 0) {
    console.log(`\n  Strengths:`);
    for (const s of summary.strengths) console.log(`    • ${s}`);
  }

  if (summary.focus_areas.length > 0) {
    console.log(`\n  Focus areas:`);
    for (const f of summary.focus_areas) {
      console.log(`    ▸ ${f.module_title} (${f.score_pct}%)`);
      console.log(`      ${f.tip}`);
      if (f.prerequisite_concepts.length > 0) {
        console.log(`      Revisit: ${f.prerequisite_concepts.join(", ")}`);
      }
    }
  }

  if (summary.study_tips.length > 0) {
    console.log(`\n  Study tips:`);
    for (const t of summary.study_tips) console.log(`    • ${t}`);
  }

  console.log(`\n  Next steps: ${summary.next_steps}`);
  console.log(`\n${hr}\n`);
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
  .action(
    async (options: {
      pdf: string;
      output: string;
      pretty: boolean;
      from?: string;
      to?: string;
      hitl: boolean;
    }) => {
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

      const workflow = mastra.getWorkflow("analyzeWorkflow");
      const run = await workflow.createRun();

      let result = await run.start({
        inputData: {
          pdfPath,
          fromLevel: options.from ?? "",
          toLevel: options.to ?? "",
        },
      });

      if (result.status === "suspended") {
        let answer: string;
        if (options.hitl) {
          // suspendPayload is keyed by step ID: { "human-approval": { summary } }
          const stepPayload = (result.suspendPayload as Record<string, { summary?: string }>)["human-approval"];
          const summary = stepPayload?.summary ?? "";
          process.stdout.write(summary);
          answer = await promptUser("  Approve this plan? [y/n]: ");
        } else {
          answer = "yes";
        }

        result = await run.resume({
          step: "human-approval",
          resumeData: { answer },
        });
      }

      if (result.status === "failed") {
        console.error("[duolearno] Error:", result.error.message);
        process.exit(1);
      }

      if (result.status !== "success") {
        console.error(`[duolearno] Unexpected status: ${result.status}`);
        process.exit(1);
      }

      const { approvalStatus, userFeedback, finalOutput, learningPath, errors } =
        result.result as z.infer<typeof AnalyzeOutputSchema>;

      if (errors.length > 0) {
        console.warn("[duolearno] Warnings:", errors);
      }

      if (approvalStatus === "rejected") {
        console.log("\n[duolearno] Plan rejected — no output written.");
        if (userFeedback) console.log(`  Feedback: ${userFeedback}`);
        process.exit(0);
      }

      if (!finalOutput) {
        console.error("[duolearno] Error: No output was generated.");
        process.exit(1);
      }

      // Persist the analysis to Postgres (durable system of record) and embed
      // its id in the output so a later `learn` run links its results back to
      // this analysis. Best-effort: a DB failure must not lose the JSON output.
      let analysisId: string | undefined;
      if (learningPath) {
        try {
          analysisId = await saveAnalysis({
            documentMetadata: finalOutput.document_metadata,
            items: finalOutput.items,
            edges: finalOutput.edges,
            assumedPrerequisites: finalOutput.prerequisites_assumed,
            clusters: finalOutput.clusters,
            learningPath,
            sourceFilename: path.basename(pdfPath),
          });
        } catch (e) {
          console.warn(
            "[duolearno] Could not persist analysis to Postgres:",
            e instanceof Error ? e.message : e
          );
        }
      }

      const fullOutput = {
        ...finalOutput,
        learning_path: learningPath,
        ...(analysisId ? { analysis_id: analysisId } : {}),
      };
      const json = options.pretty ? JSON.stringify(fullOutput, null, 2) : JSON.stringify(fullOutput);
      fs.writeFileSync(outputPath, json, "utf-8");

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n[duolearno] Done in ${elapsed}s`);
      console.log(`  Items extracted  : ${finalOutput.items.length}`);
      console.log(`  Prerequisite edges: ${finalOutput.edges.length}`);
      console.log(`  Clusters         : ${finalOutput.clusters.length}`);
      if (learningPath) {
        console.log(`  Learning modules : ${learningPath.modules.length}`);
        console.log(`  Total study time : ${learningPath.total_estimated_minutes} min`);
      }
      console.log(`  Output           : ${outputPath}`);
      if (analysisId) console.log(`  Analysis ID      : ${analysisId}`);
    }
  );

program
  .command("learn")
  .description("Interactive quiz loop over the modules in an analyze output")
  .requiredOption("--input <path>", "Path to the analyze output JSON")
  .action(async (options: { input: string }) => {
    if (!process.env.GEMINI_API_KEY) {
      console.error("Error: GEMINI_API_KEY environment variable is not set.");
      process.exit(1);
    }

    const inputPath = path.resolve(options.input);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: Input file not found at ${inputPath}`);
      process.exit(1);
    }

    let rawJson: Record<string, unknown>;
    try {
      rawJson = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    } catch {
      console.error("Error: Failed to parse input JSON.");
      process.exit(1);
    }

    const learningPath = rawJson.learning_path as LearningPath | undefined;
    const items = rawJson.items as Item[] | undefined;
    const documentMetadata = rawJson.document_metadata as DocumentMetadata | undefined;

    if (!learningPath?.modules?.length || !items || !documentMetadata) {
      console.error("Error: Input JSON is missing learning_path, items, or document_metadata.");
      console.error("Run `analyze` first to generate this file.");
      process.exit(1);
    }

    const hr = "─".repeat(58);
    console.log(`\n${hr}`);
    console.log(`  ${learningPath.title}`);
    console.log(hr);
    console.log(`  Modules   : ${learningPath.modules.length}`);
    console.log(`  Study time: ~${learningPath.total_estimated_minutes} min`);
    console.log(`  From      : ${learningPath.from_level}`);
    console.log(`  To        : ${learningPath.to_level}`);
    console.log(`${hr}\n`);

    const workflow = mastra.getWorkflow("learnWorkflow");
    const run = await workflow.createRun();

    let result = await run.start({
      inputData: { learningPath, items, documentMetadata },
      initialState: EMPTY_QUIZ_STATE,
    });

    while (result.status === "suspended") {
      // suspendPayload is keyed by step ID: { "quiz": { questionText } }
      const stepPayload = (result.suspendPayload as Record<string, { questionText?: string }>)["quiz"];
      const { questionText = "" } = stepPayload ?? {};
      process.stdout.write(questionText);
      const answer = await promptUser("  Your answer (A/B/C/D): ");

      result = await run.resume({
        step: "quiz",
        resumeData: { answer },
      });
    }

    if (result.status === "failed") {
      console.error("[duolearno] Error:", result.error.message);
      process.exit(1);
    }

    if (result.status !== "success") {
      console.error(`[duolearno] Unexpected status: ${result.status}`);
      process.exit(1);
    }

    const learnResult = result.result as z.infer<typeof LearnOutputSchema>;
    printFinalSummary(learnResult.moduleResults, learnResult.learningPath);

    const edges = (rawJson.edges as Edge[] | undefined) ?? [];
    const assumedPrerequisites =
      (rawJson.prerequisites_assumed as AssumedPrerequisite[] | undefined) ?? [];

    // Persist the run to Postgres: reuse the analysis row if the input JSON
    // carries an analysis_id from `analyze`, otherwise create one from the
    // input. Best-effort — never fail the session over a DB error.
    let sessionId: string | undefined;
    try {
      let analysisId =
        typeof rawJson.analysis_id === "string" ? (rawJson.analysis_id as string) : undefined;
      if (!analysisId || !(await analysisExists(analysisId))) {
        analysisId = await saveAnalysis({
          documentMetadata,
          items,
          edges,
          assumedPrerequisites,
          clusters: (rawJson.clusters as unknown[] | undefined) ?? [],
          learningPath,
          sourceFilename: path.basename(inputPath),
        });
      }
      sessionId = await createQuizSession({
        analysisId,
        title: learningPath.title,
        source: "cli",
      });
      await saveModuleResults(sessionId, learnResult.moduleResults);
      console.log(`  Saved results to Postgres (session ${sessionId}).\n`);
    } catch (e) {
      console.warn(
        "[duolearno] Could not persist quiz results:",
        e instanceof Error ? e.message : e
      );
    }

    // Generate the graph-grounded performance summary + study tips, print it,
    // and persist it (if we have a session). Best-effort — never fail the run.
    try {
      console.log("[duolearno] Generating your performance summary...\n");
      const summary = await generatePerformanceSummary({
        moduleResults: learnResult.moduleResults,
        learningPath,
        items,
        edges,
        assumedPrerequisites,
      });
      printPerformanceSummary(summary);
      if (sessionId) await saveSessionSummary(sessionId, summary);
    } catch (e) {
      console.warn(
        "[duolearno] Could not generate performance summary:",
        e instanceof Error ? e.message : e
      );
    }
  });

program.parse(process.argv);
