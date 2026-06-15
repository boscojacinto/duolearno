"use client";
import { useState, useRef, useEffect } from "react";
import {
  useHumanInTheLoop,
  useAgentContext,
  useRenderTool,
  useAgent,
  useCopilotKit,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import MCQCard from "./components/MCQCard";
import ApprovalCard from "./components/ApprovalCard";
import QuizPrepCard from "./components/QuizPrepCard";
import PerformanceSummaryCard from "./components/PerformanceSummaryCard";
import ModuleDivider from "./components/ModuleDivider";
import AnalyzeProgress from "./components/AnalyzeProgress";
import type { PerformanceSummary } from "@/src/types/learning-loop";

type AppState = "upload" | "analyzing" | "approving" | "quiz";

// Estimate quiz length from the modules. Question count per module mirrors
// generateMcqs: max(3, min(objectives + 1, 6)). Answering an MCQ is quick
// (~30s), unlike the learning path's `total_estimated_minutes`, which is the
// time to *study* the material — far too long for a quiz.
const SECONDS_PER_QUESTION = 30;
function estimateQuiz(modules: { learning_objectives: string[] }[]): {
  questions: number;
  minutes: number;
} {
  const questions = modules.reduce(
    (sum, m) => sum + Math.max(3, Math.min((m.learning_objectives?.length ?? 0) + 1, 6)),
    0
  );
  const minutes = Math.max(1, Math.round((questions * SECONDS_PER_QUESTION) / 60));
  return { questions, minutes };
}

interface QuizData {
  sessionId: string;
  learningPath: {
    title: string;
    modules: Array<{
      module_id: string;
      title: string;
      learning_objectives: string[];
      item_ids: string[];
      estimated_minutes: number;
      is_milestone: boolean;
      milestone_description: string;
      cluster_id: string;
    }>;
    from_level: string;
    to_level: string;
    total_estimated_minutes: number;
    prerequisites_summary: string;
  };
}

export default function Page() {
  const [appState, setAppState] = useState<AppState>("upload");
  const [runId, setRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [currentModule, setCurrentModule] = useState<string | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeStepId, setAnalyzeStepId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The present_question render closure can capture stale state (quizData is
  // null at mount), so expose live values via refs the closure reads at call time.
  const sessionIdRef = useRef("");
  sessionIdRef.current = quizData?.sessionId ?? "";
  const currentModuleRef = useRef<string | null>(null);
  currentModuleRef.current = currentModule;
  // Live learning path for the render closure — used to flag the last module so
  // the result endpoint can mark the session complete.
  const learningPathRef = useRef<QuizData["learningPath"] | null>(null);
  learningPathRef.current = quizData?.learningPath ?? null;
  // Real per-module question count, captured from each generate_mcqs result. The
  // agent's own `total` arg is unreliable (it produced "Question 5 / 4"), so the
  // number of questions the tool actually returned is the source of truth.
  const questionTotalsRef = useRef<Map<string, number>>(new Map());

  // Share quiz data with the CopilotKit agent
  useAgentContext({
    description: "Current quiz session: sessionId for MCQ generation, and learningPath with modules to quiz on",
    value: quizData ?? {},
  });

  // HITL hook for MCQ questions — always mounted, renders MCQCard when agent calls present_question
  useHumanInTheLoop({
    name: "present_question",
    description: "Present a multiple-choice question to the learner and wait for their answer",
    parameters: z.object({
      question: z.string().describe("The question text"),
      options: z.array(z.string()).describe("Four answer options (plain text, no A/B/C/D prefix)"),
      moduleTitle: z.string().describe("Title of the current module"),
      questionIndex: z.number().int().describe("0-based index of this question within the module"),
      total: z.number().int().describe("Total number of questions in this module"),
      correct_index: z.number().int().min(0).max(3).describe("0-based index of the correct option"),
      explanation: z.string().describe("Explanation shown after the user answers"),
    }),
    render: ({ status, args, respond }) => {
      // Args still streaming — nothing to show yet.
      if (status === "inProgress") return <></>;
      const lp = learningPathRef.current;
      const moduleIdx = lp ? lp.modules.findIndex((m) => m.title === args.moduleTitle) : -1;
      const isLastModule = moduleIdx >= 0 && moduleIdx === lp!.modules.length - 1;
      // Prefer the real generated count over the agent's unreliable `total`.
      const total = questionTotalsRef.current.get(args.moduleTitle) ?? args.total;
      // Render both the live question (executing) and the answered one
      // (complete) so the correct answer stays visible for every question.
      return (
        <>
          {args.questionIndex === 0 && (
            <ModuleDivider
              title={args.moduleTitle}
              index={moduleIdx}
              totalModules={lp?.modules.length}
            />
          )}
          <MCQCard
            question={args.question}
            options={args.options}
            moduleTitle={args.moduleTitle}
            questionIndex={args.questionIndex}
            total={total}
            correct_index={args.correct_index}
            explanation={args.explanation}
            active={status === "executing"}
            currentModule={currentModuleRef.current}
            onActivate={setCurrentModule}
            sessionId={sessionIdRef.current}
            isLastModule={isLastModule}
            respond={respond}
          />
        </>
      );
    },
  });

  // Render the server-side generate_mcqs tool call as a friendly "preparing
  // questions" card instead of the raw tool-name widget. Hidden once complete.
  useRenderTool({
    name: "generate_mcqs",
    parameters: z.object({
      module: z.object({ title: z.string() }).partial().passthrough().optional(),
    }),
    render: ({ status, parameters, result }) => {
      if (status === "complete") {
        // Record how many questions were actually generated for this module so
        // present_question can show a correct "N / total".
        const title = parameters?.module?.title;
        if (title) {
          try {
            const parsed = typeof result === "string" ? JSON.parse(result) : result;
            const n = (parsed as { questions?: unknown[] } | undefined)?.questions?.length;
            if (typeof n === "number" && n > 0) questionTotalsRef.current.set(title, n);
          } catch {
            /* leave total to the agent-provided fallback */
          }
        }
        return <></>;
      }
      // Only switch the active module once args are fully assembled (executing),
      // so a partially-streamed title doesn't flicker into the header.
      return (
        <QuizPrepCard
          moduleTitle={parameters?.module?.title}
          onShow={status === "executing" ? setCurrentModule : undefined}
        />
      );
    },
  });

  // Render the end-of-quiz performance summary + study tips. The agent calls the
  // server-side present_summary tool once all modules are done; its result is the
  // generated PerformanceSummary.
  useRenderTool({
    name: "present_summary",
    parameters: z.object({ sessionId: z.string() }),
    render: ({ status, result }) => {
      if (status !== "complete") {
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "14px 18px",
              margin: "8px 0",
              background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              maxWidth: 640,
              fontSize: 14,
              color: "#4a5568",
              fontWeight: 500,
            }}
          >
            <span aria-hidden>📊</span> Preparing your performance summary…
          </div>
        );
      }
      // Server-tool results arrive as the tool message content — a JSON string,
      // not a parsed object — so decode it before reading the summary.
      let payload: { summary?: PerformanceSummary; error?: string; headline?: string } | undefined;
      try {
        payload = typeof result === "string" ? JSON.parse(result) : (result as typeof payload);
      } catch {
        payload = undefined;
      }
      // Tolerate either a { summary } wrapper or a bare summary object.
      const summary = payload?.summary ?? (payload?.headline ? (payload as PerformanceSummary) : undefined);
      if (summary) return <PerformanceSummaryCard summary={summary} />;
      return (
        <div
          style={{
            border: "1px solid #fed7d7",
            background: "#fff5f5",
            color: "#9b2c2c",
            borderRadius: 12,
            padding: "14px 18px",
            margin: "8px 0",
            maxWidth: 640,
            fontSize: 14,
          }}
        >
          Couldn’t generate your performance summary{payload?.error ? `: ${payload.error}` : "."}
        </div>
      );
    },
  });

  // Auto-start the quiz once the learning path is ready, so the learner doesn't
  // have to type "start" (the agent's system prompt triggers on this message).
  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const quizStartedRef = useRef(false);

  useEffect(() => {
    if (appState !== "quiz" || !quizData || !agent || quizStartedRef.current) return;
    quizStartedRef.current = true;
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "start" });
    void copilotkit.runAgent({ agent });
  }, [appState, quizData, agent, copilotkit]);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".pdf")) {
      setAnalyzeError("Please upload a PDF file.");
      return;
    }
    setAnalyzeError(null);
    setAnalyzeStepId(null);
    setAppState("analyzing");

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      const res = await fetch("/api/analyze", { method: "POST", body: formData });

      // A non-OK response is plain JSON (e.g. validation error), not a stream.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setAnalyzeError(data.error ?? "Analysis failed");
        setAppState("upload");
        return;
      }

      // Consume the SSE stream of workflow step events, advancing the stepper
      // until the workflow suspends at the human-approval gate.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by a blank line.
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          let event = "message";
          let dataStr = "";
          for (const line of message.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          const data = JSON.parse(dataStr);

          if (event === "step" && data.status === "start") {
            setAnalyzeStepId(data.id as string);
          } else if (event === "suspended") {
            setRunId(data.runId);
            setSummary(data.summary);
            setAppState("approving");
            finished = true;
            break;
          } else if (event === "error") {
            setAnalyzeError(data.message ?? "Analysis failed");
            setAppState("upload");
            finished = true;
            break;
          }
        }
      }
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Network error");
      setAppState("upload");
    }
  };

  const handleApprove = async () => {
    if (!runId) return;
    setApprovalLoading(true);

    try {
      const res = await fetch("/api/analyze/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, approved: true }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setAnalyzeError(data.error ?? "Resume failed");
        setAppState("upload");
        return;
      }

      if (data.rejected) {
        setAppState("upload");
        return;
      }

      setQuizData({ sessionId: data.sessionId, learningPath: data.learningPath });
      setAppState("quiz");
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Network error");
      setAppState("upload");
    } finally {
      setApprovalLoading(false);
    }
  };

  const handleReject = async () => {
    if (!runId) return;
    await fetch("/api/analyze/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, approved: false }),
    });
    setRunId(null);
    setSummary(null);
    setAppState("upload");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f7f8fc" }}>
      {/* Upload state */}
      {appState === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "#1a202c", marginBottom: 8 }}>DuoLearno</h1>
          <p style={{ color: "#718096", marginBottom: 40, fontSize: 16 }}>Upload a PDF to generate an interactive quiz</p>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: "100%",
              maxWidth: 480,
              height: 200,
              border: `2px dashed ${isDragging ? "#4f46e5" : "#cbd5e0"}`,
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              background: isDragging ? "#eef2ff" : "#fff",
              transition: "all 0.2s",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 40 }}>📄</span>
            <span style={{ fontSize: 15, color: "#4a5568", fontWeight: 500 }}>
              Drop a PDF here or click to browse
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {analyzeError && (
            <p style={{ color: "#e53e3e", marginTop: 16, fontSize: 14 }}>{analyzeError}</p>
          )}
        </div>
      )}

      {/* Analyzing state */}
      {appState === "analyzing" && <AnalyzeProgress currentStepId={analyzeStepId} />}

      {/* Approval state */}
      {appState === "approving" && (
        <div style={{ padding: 24 }}>
          <ApprovalCard
            summary={summary ?? "Analysis complete."}
            onApprove={handleApprove}
            onReject={handleReject}
            loading={approvalLoading}
          />
        </div>
      )}

      {/* Quiz state */}
      {appState === "quiz" && quizData && (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <div style={{
            padding: "12px 24px",
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>🎓</span>
            <span style={{ fontWeight: 600, color: "#1a202c" }}>{quizData.learningPath.title}</span>
            {(() => {
              const { questions, minutes } = estimateQuiz(quizData.learningPath.modules);
              return (
                <span style={{ fontSize: 13, color: "#718096" }}>
                  {quizData.learningPath.modules.length} modules · ~{questions} questions · ~{minutes} min
                </span>
              );
            })()}
            {currentModule && (() => {
              const idx = quizData.learningPath.modules.findIndex((m) => m.title === currentModule);
              return (
                <span style={{
                  marginLeft: "auto",
                  padding: "4px 12px",
                  background: "#eef2ff",
                  color: "#4338ca",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}>
                  {idx >= 0 ? `Module ${idx + 1}/${quizData.learningPath.modules.length}: ` : ""}{currentModule}
                </span>
              );
            })()}
          </div>
          <div style={{ flex: 1 }}>
            <CopilotChat agentId="default" />
          </div>
        </div>
      )}
    </div>
  );
}
