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

type AppState = "upload" | "analyzing" | "approving" | "quiz";

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
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // Render both the live question (executing) and the answered one
      // (complete) so the correct answer stays visible for every question.
      return (
        <MCQCard
          question={args.question}
          options={args.options}
          moduleTitle={args.moduleTitle}
          questionIndex={args.questionIndex}
          total={args.total}
          correct_index={args.correct_index}
          explanation={args.explanation}
          active={status === "executing"}
          currentModule={currentModule}
          onActivate={setCurrentModule}
          respond={respond}
        />
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
    render: ({ status, parameters }) => {
      if (status === "complete") return <></>;
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
    setAppState("analyzing");

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || data.error) {
        setAnalyzeError(data.error ?? "Analysis failed");
        setAppState("upload");
        return;
      }

      setRunId(data.runId);
      setSummary(data.summary);
      setAppState("approving");
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
      {appState === "analyzing" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16 }}>
          <div style={{ fontSize: 40 }}>⏳</div>
          <p style={{ fontSize: 18, color: "#4a5568", fontWeight: 500 }}>Analyzing your PDF…</p>
          <p style={{ fontSize: 14, color: "#a0aec0" }}>This takes 10–30 seconds. Please wait.</p>
        </div>
      )}

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
            <span style={{ fontSize: 13, color: "#718096" }}>
              {quizData.learningPath.modules.length} modules · ~{quizData.learningPath.total_estimated_minutes} min
            </span>
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
