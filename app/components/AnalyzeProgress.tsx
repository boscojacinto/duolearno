"use client";

// The analyze workflow's steps (ids match src/agents/analyze/steps.ts) in
// learner-friendly language. The human-approval step is the "Review your plan"
// phase shown under "Then".
const ANALYZE_STEPS = [
  { id: "extract-pdf", label: "Reading your PDF", icon: "📄" },
  { id: "identify-domain", label: "Identifying the subject", icon: "🔎" },
  { id: "extract-concepts", label: "Extracting key concepts", icon: "🧩" },
  { id: "build-graph", label: "Mapping prerequisites", icon: "🕸️" },
  { id: "format-output", label: "Ordering the learning path", icon: "🧭" },
  { id: "generate-learning-path", label: "Building your lesson plan", icon: "📚" },
];

// The journey after analysis (Phase 2 approval, Phase 3 quiz, Phase 4 summary).
const NEXT_PHASES = ["Review your plan", "Take the quiz", "Get your summary"];

// `currentStepId` is the id of the step currently running, streamed live from the
// analyze workflow. null = just starting; a value past the list (e.g. the
// human-approval step) means every visible step is done.
export default function AnalyzeProgress({ currentStepId }: { currentStepId: string | null }) {
  const activeIndex = !currentStepId
    ? 0
    : (() => {
        const idx = ANALYZE_STEPS.findIndex((s) => s.id === currentStepId);
        return idx === -1 ? ANALYZE_STEPS.length : idx;
      })();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          padding: "28px 28px 24px",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#1a202c" }}>
          Building your lesson
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#718096" }}>
          Analyzing your PDF — this usually takes 10–30 seconds.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {ANALYZE_STEPS.map((step, i) => {
            const done = i < activeIndex;
            const current = i === activeIndex;
            return (
              <div
                key={step.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 4px",
                  opacity: done || current ? 1 : 0.45,
                  transition: "opacity 0.3s",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    background: done ? "#4f46e5" : current ? "#eef2ff" : "#edf2f7",
                    color: done ? "#fff" : "#4338ca",
                    border: current ? "1.5px solid #4f46e5" : "1.5px solid transparent",
                  }}
                >
                  {done ? (
                    "✓"
                  ) : current ? (
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        height: 12,
                        border: "2px solid #c3dafe",
                        borderTopColor: "#4f46e5",
                        borderRadius: "50%",
                        animation: "duolearno-spin 0.7s linear infinite",
                      }}
                    />
                  ) : (
                    i + 1
                  )}
                </span>
                <span style={{ fontSize: 15 }}>{step.icon}</span>
                <span
                  style={{
                    fontSize: 14.5,
                    color: done ? "#4a5568" : current ? "#1a202c" : "#a0aec0",
                    fontWeight: current ? 600 : 500,
                  }}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #edf2f7" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#a0aec0",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            Then
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {NEXT_PHASES.map((phase, i) => (
              <span
                key={phase}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 999,
                  background: "#f7fafc",
                  border: "1px solid #e2e8f0",
                  fontSize: 12.5,
                  color: "#718096",
                  fontWeight: 500,
                }}
              >
                <span style={{ fontWeight: 700, color: "#cbd5e0" }}>{i + 1}</span>
                {phase}
              </span>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes duolearno-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
