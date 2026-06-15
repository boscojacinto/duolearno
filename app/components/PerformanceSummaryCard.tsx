"use client";
import type { PerformanceSummary } from "@/src/types/learning-loop";

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "24px 28px",
  margin: "8px 0",
  background: "#fff",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  maxWidth: 680,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#718096",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "20px 0 8px",
};

function scoreColor(pct: number): string {
  if (pct >= 80) return "#276749";
  if (pct >= 50) return "#b45309";
  return "#9b2c2c";
}

export default function PerformanceSummaryCard({ summary }: { summary: PerformanceSummary }) {
  const { headline, accuracy_pct, correct_answers, total_questions, strengths, focus_areas, study_tips, next_steps } =
    summary;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 22 }}>🎉</span>
        <h2 style={{ margin: 0, fontSize: 19, color: "#1a202c" }}>Your Performance</h2>
        <span
          style={{
            marginLeft: "auto",
            padding: "4px 12px",
            background: "#eef2ff",
            color: scoreColor(accuracy_pct),
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {correct_answers}/{total_questions} · {accuracy_pct}%
        </span>
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.6, color: "#2d3748" }}>{headline}</p>

      {strengths.length > 0 && (
        <>
          <div style={sectionTitle}>Strengths</div>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#2d3748", fontSize: 14, lineHeight: 1.7 }}>
            {strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}

      {focus_areas.length > 0 && (
        <>
          <div style={sectionTitle}>Focus Areas</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {focus_areas.map((f, i) => (
              <div
                key={i}
                style={{
                  padding: "12px 14px",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: "#1a202c", fontSize: 14 }}>{f.module_title}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor(f.score_pct) }}>
                    {f.score_pct}%
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: "#92400e", lineHeight: 1.6 }}>{f.tip}</div>
                {f.prerequisite_concepts.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {f.prerequisite_concepts.map((c, j) => (
                      <span
                        key={j}
                        style={{
                          padding: "2px 10px",
                          background: "#fff",
                          border: "1px solid #fcd34d",
                          borderRadius: 999,
                          fontSize: 12,
                          color: "#b45309",
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {study_tips.length > 0 && (
        <>
          <div style={sectionTitle}>Study Tips</div>
          <ul style={{ margin: 0, paddingLeft: 20, color: "#2d3748", fontSize: 14, lineHeight: 1.7 }}>
            {study_tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}

      <div
        style={{
          marginTop: 20,
          padding: "12px 16px",
          background: "#f0fff4",
          border: "1px solid #9ae6b4",
          borderRadius: 8,
          fontSize: 14,
          color: "#276749",
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontWeight: 600 }}>Next steps: </span>
        {next_steps}
      </div>
    </div>
  );
}
