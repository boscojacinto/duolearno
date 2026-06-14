"use client";
import { useState, useEffect } from "react";

const LABELS = ["A", "B", "C", "D"] as const;

interface MCQCardProps {
  question: string;
  options: string[];
  moduleTitle: string;
  questionIndex: number;
  total: number;
  correct_index: number;
  explanation: string;
  /** True while this is the live question (status === "executing"). */
  active: boolean;
  /** Title of the module currently in progress; used to collapse older ones. */
  currentModule: string | null;
  /** Notify the page which module is active. */
  onActivate: (moduleTitle: string) => void;
  /** Defined only while active; resolves the human-in-the-loop call. */
  respond?: (result: { answer: string }) => void;
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "20px 24px",
  margin: "8px 0",
  background: "#fff",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  maxWidth: 640,
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  color: "#718096",
  marginBottom: 12,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export default function MCQCard({
  question,
  options,
  moduleTitle,
  questionIndex,
  total,
  correct_index,
  explanation,
  active,
  currentModule,
  onActivate,
  respond,
}: MCQCardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Tell the page which module is live so previous ones can collapse.
  useEffect(() => {
    if (active) onActivate(moduleTitle);
  }, [active, moduleTitle, onActivate]);

  const handleSubmit = () => {
    if (selected === null || submitted || !respond) return;
    setSubmitted(true);
    setTimeout(() => respond({ answer: LABELS[selected] }), 1800);
  };

  // ── Active (live) question — interactive ─────────────────────────────────
  if (active) {
    const isCorrect = submitted && selected === correct_index;
    return (
      <div style={cardStyle}>
        <div style={metaStyle}>
          <span>{moduleTitle}</span>
          <span>Question {questionIndex + 1} / {total}</span>
        </div>

        <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.6, color: "#1a202c", fontWeight: 500 }}>
          {question}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {options.map((opt, i) => {
            let bg = "#f7fafc";
            let borderColor = "#e2e8f0";
            let color = "#2d3748";

            if (submitted) {
              if (i === correct_index) {
                bg = "#f0fff4"; borderColor = "#68d391"; color = "#276749";
              } else if (i === selected && i !== correct_index) {
                bg = "#fff5f5"; borderColor = "#fc8181"; color = "#9b2c2c";
              }
            } else if (i === selected) {
              bg = "#ebf4ff"; borderColor = "#4299e1"; color = "#2b6cb0";
            }

            return (
              <button
                key={i}
                disabled={submitted}
                onClick={() => !submitted && setSelected(i)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 14px",
                  background: bg,
                  border: `1.5px solid ${borderColor}`,
                  borderRadius: 8,
                  fontSize: 14,
                  color,
                  cursor: submitted ? "default" : "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 20 }}>{LABELS[i]})</span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>

        {submitted ? (
          <div style={{
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 8,
            background: isCorrect ? "#f0fff4" : "#fff5f5",
            border: `1px solid ${isCorrect ? "#9ae6b4" : "#feb2b2"}`,
            fontSize: 14,
            color: isCorrect ? "#276749" : "#9b2c2c",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {isCorrect
                ? "✓ Correct!"
                : `✗ Correct answer: ${LABELS[correct_index]}) ${options[correct_index]}`}
            </div>
            <div style={{ color: "#4a5568", fontSize: 13 }}>{explanation}</div>
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={selected === null}
            style={{
              marginTop: 16,
              padding: "10px 28px",
              background: selected === null ? "#e2e8f0" : "#4f46e5",
              color: selected === null ? "#a0aec0" : "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: selected === null ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            Submit
          </button>
        )}
      </div>
    );
  }

  // ── Answered question — read-only review (correct answer always shown) ───
  const answered = submitted && selected !== null;
  const wasCorrect = answered && selected === correct_index;

  const reviewBody = (
    <>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.6, color: "#1a202c", fontWeight: 500 }}>
        {question}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.map((opt, i) => {
          const isCorrectOpt = i === correct_index;
          const isWrongPick = answered && i === selected && i !== correct_index;
          let bg = "#f7fafc";
          let borderColor = "#e2e8f0";
          let color = "#4a5568";
          if (isCorrectOpt) { bg = "#f0fff4"; borderColor = "#68d391"; color = "#276749"; }
          else if (isWrongPick) { bg = "#fff5f5"; borderColor = "#fc8181"; color = "#9b2c2c"; }
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "8px 12px",
                background: bg,
                border: `1.5px solid ${borderColor}`,
                borderRadius: 8,
                fontSize: 13,
                color,
              }}
            >
              <span style={{ fontWeight: 700, minWidth: 20 }}>{LABELS[i]})</span>
              <span>{opt}</span>
              {isCorrectOpt && <span style={{ marginLeft: "auto", fontWeight: 600 }}>✓ correct</span>}
              {isWrongPick && <span style={{ marginLeft: "auto", fontWeight: 600 }}>your answer</span>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: "#4a5568" }}>{explanation}</div>
    </>
  );

  const mark = !answered ? "" : wasCorrect ? "✓ " : "✗ ";

  // Previous-module questions collapse; current-module answered ones stay open.
  const collapsed = currentModule !== null && moduleTitle !== currentModule;

  if (collapsed) {
    return (
      <details style={cardStyle}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#4a5568", listStyle: "revert" }}>
          <span style={{ fontWeight: 600, color: wasCorrect ? "#276749" : answered ? "#9b2c2c" : "#4a5568" }}>{mark}</span>
          <span style={{ color: "#718096" }}>{moduleTitle} · Q{questionIndex + 1}</span>
          {" — "}
          <span>{question}</span>
        </summary>
        <div style={{ marginTop: 12 }}>{reviewBody}</div>
      </details>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={metaStyle}>
        <span>{moduleTitle}</span>
        <span>Question {questionIndex + 1} / {total}</span>
      </div>
      {reviewBody}
    </div>
  );
}
