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
  const [triedWrong, setTriedWrong] = useState<number[]>([]);
  const [concluded, setConcluded] = useState(false); // true once answered correctly
  const [hints, setHints] = useState<string[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  // Tell the page which module is live so previous ones can collapse.
  useEffect(() => {
    if (active) onActivate(moduleTitle);
  }, [active, moduleTitle, onActivate]);

  const handleSubmit = () => {
    if (selected === null || concluded) return;
    if (selected === correct_index) {
      setConcluded(true);
      const answer = LABELS[selected];
      if (respond) setTimeout(() => respond({ answer }), 1800);
      return;
    }
    // Wrong: lock that option, clear the pick, offer a hint + retry. Never reveal.
    setTriedWrong((prev) => (prev.includes(selected) ? prev : [...prev, selected]));
    setSelected(null);
  };

  const getHint = async () => {
    setHintLoading(true);
    setHintError(null);
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          correct_index,
          explanation,
          moduleTitle,
          previousHints: hints,
          attempts: triedWrong.length,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.hint) {
        setHintError(data.error ?? "Couldn't fetch a hint. Try again.");
      } else {
        setHints((prev) => [...prev, data.hint as string]);
      }
    } catch {
      setHintError("Couldn't reach the tutor. Try again.");
    } finally {
      setHintLoading(false);
    }
  };

  // ── Active (live) question — interactive, retry-until-correct ─────────────
  if (active) {
    const wrongAttempted = triedWrong.length > 0;
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
            const isTriedWrong = triedWrong.includes(i);
            const isCorrectDone = concluded && i === correct_index;
            const locked = concluded || isTriedWrong;

            let bg = "#f7fafc";
            let borderColor = "#e2e8f0";
            let color = "#2d3748";
            if (isCorrectDone) { bg = "#f0fff4"; borderColor = "#68d391"; color = "#276749"; }
            else if (isTriedWrong) { bg = "#fff5f5"; borderColor = "#fc8181"; color = "#9b2c2c"; }
            else if (i === selected) { bg = "#ebf4ff"; borderColor = "#4299e1"; color = "#2b6cb0"; }

            return (
              <button
                key={i}
                disabled={locked}
                onClick={() => !locked && setSelected(i)}
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
                  cursor: locked ? "default" : "pointer",
                  opacity: isTriedWrong && !concluded ? 0.6 : 1,
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 20 }}>{LABELS[i]})</span>
                <span>{opt}</span>
                {isTriedWrong && <span style={{ marginLeft: "auto", fontWeight: 600 }}>✗</span>}
              </button>
            );
          })}
        </div>

        {concluded ? (
          <div style={{
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 8,
            background: "#f0fff4",
            border: "1px solid #9ae6b4",
            fontSize: 14,
            color: "#276749",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>✓ Correct!</div>
            <div style={{ color: "#4a5568", fontSize: 13 }}>{explanation}</div>
          </div>
        ) : (
          <>
            {wrongAttempted && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, color: "#9b2c2c", fontWeight: 500, marginBottom: hints.length ? 8 : 0 }}>
                  Not quite — pick another option, or ask for a hint.
                </div>
                {hints.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "8px 12px",
                      marginBottom: 6,
                      background: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: 8,
                      fontSize: 13,
                      color: "#92400e",
                    }}
                  >
                    <span aria-hidden>💡</span>
                    <span><b>Hint {i + 1}:</b> {h}</span>
                  </div>
                ))}
                {hintError && (
                  <div style={{ fontSize: 12, color: "#e53e3e", marginBottom: 6 }}>{hintError}</div>
                )}
                <button
                  onClick={getHint}
                  disabled={hintLoading}
                  style={{
                    padding: "6px 14px",
                    background: "#fff",
                    color: "#b45309",
                    border: "1px solid #fcd34d",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: hintLoading ? "default" : "pointer",
                  }}
                >
                  {hintLoading ? "Thinking…" : hints.length ? "Get another hint" : "💡 Get a hint"}
                </button>
              </div>
            )}

            <div>
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
                {wrongAttempted ? "Try again" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Answered question — read-only review (always answered correctly) ─────
  const reviewBody = (
    <>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.6, color: "#1a202c", fontWeight: 500 }}>
        {question}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.map((opt, i) => {
          const isCorrectOpt = i === correct_index;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "8px 12px",
                background: isCorrectOpt ? "#f0fff4" : "#f7fafc",
                border: `1.5px solid ${isCorrectOpt ? "#68d391" : "#e2e8f0"}`,
                borderRadius: 8,
                fontSize: 13,
                color: isCorrectOpt ? "#276749" : "#4a5568",
              }}
            >
              <span style={{ fontWeight: 700, minWidth: 20 }}>{LABELS[i]})</span>
              <span>{opt}</span>
              {isCorrectOpt && <span style={{ marginLeft: "auto", fontWeight: 600 }}>✓</span>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: "#4a5568" }}>{explanation}</div>
    </>
  );

  // Previous-module questions collapse; current-module answered ones stay open.
  const collapsed = currentModule !== null && moduleTitle !== currentModule;

  if (collapsed) {
    return (
      <details style={cardStyle}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#4a5568", listStyle: "revert" }}>
          <span style={{ fontWeight: 600, color: "#276749" }}>✓ </span>
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
