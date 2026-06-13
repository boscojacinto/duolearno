import "dotenv/config";
import fs from "fs";
import path from "path";
import { Command } from "commander";
import { buildPrerequisiteGraphAgent } from "./agents/prerequisite-graph/graph";

const program = new Command();

program
  .name("duolearno")
  .description("AI learning agent that transforms PDFs into interactive lessons")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze a PDF and generate a prerequisite graph")
  .requiredOption("--pdf <path>", "Path to the PDF file")
  .option("--output <path>", "Output JSON file path", "prerequisite-graph.json")
  .option("--pretty", "Pretty-print JSON output", false)
  .action(async (options: { pdf: string; output: string; pretty: boolean }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
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
    const result = await agent.invoke({ pdfPath });

    if (result.errors.length > 0) {
      console.warn("[duolearno] Warnings:", result.errors);
    }

    if (!result.finalOutput) {
      console.error("[duolearno] Error: No output was generated.");
      process.exit(1);
    }

    const json = options.pretty
      ? JSON.stringify(result.finalOutput, null, 2)
      : JSON.stringify(result.finalOutput);

    fs.writeFileSync(outputPath, json, "utf-8");

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n[duolearno] Done in ${elapsed}s`);
    console.log(`  Items extracted : ${result.finalOutput.items.length}`);
    console.log(`  Prerequisite edges: ${result.finalOutput.edges.length}`);
    console.log(`  Clusters        : ${result.finalOutput.clusters.length}`);
    console.log(`  Output          : ${outputPath}`);
  });

program.parse(process.argv);
