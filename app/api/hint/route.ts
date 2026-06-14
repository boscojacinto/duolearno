import { NextRequest, NextResponse } from "next/server";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

const googleAI = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
const gemini = googleAI("gemini-3.1-flash-lite");

const LABELS = ["A", "B", "C", "D"];

const HINT_SYSTEM_PROMPT = `You are a patient tutor helping a learner who just answered a multiple-choice question incorrectly.

Give ONE short hint (1–2 sentences) that nudges them toward the correct reasoning.

Hard rules:
- NEVER reveal, name, quote, or point at the correct option (no "the answer is…", no option letter, no paraphrase of the correct option's text).
- Do NOT say which options are wrong by letter either.
- Guide the THINKING: point to the concept, the distinction to consider, or a common misconception to re-check.
- Each successive hint must be MORE specific than the previous ones, but still must not give away the answer.
- Respond with the hint text only — no preamble, no markdown.`;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    question: string;
    options: string[];
    correct_index: number;
    explanation?: string;
    moduleTitle?: string;
    previousHints?: string[];
    attempts?: number;
  };

  const { question, options, correct_index, explanation, moduleTitle, previousHints = [] } = body;

  if (!question || !Array.isArray(options) || typeof correct_index !== "number") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const optionList = options.map((o, i) => `${LABELS[i]}) ${o}`).join("\n");
  const priorHints =
    previousHints.length > 0
      ? `\nHints already given (make the next one more specific, do not repeat):\n${previousHints
          .map((h, i) => `${i + 1}. ${h}`)
          .join("\n")}`
      : "\nNo hints given yet — start with a gentle conceptual nudge.";

  // The correct option and explanation are provided ONLY so you can steer the
  // learner toward the right reasoning while avoiding revealing it.
  const prompt = `${moduleTitle ? `Module: ${moduleTitle}\n` : ""}Question: ${question}

Options:
${optionList}

(For your reasoning only — never reveal this) The correct option is ${LABELS[correct_index]}.${
    explanation ? ` Why: ${explanation}` : ""
  }
${priorHints}

Write the next hint now.`;

  try {
    const { text } = await generateText({
      model: gemini,
      system: HINT_SYSTEM_PROMPT,
      prompt,
    });
    return NextResponse.json({ hint: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
