"use client";
import { useEffect } from "react";

// Friendly UI for the server-side `generate_mcqs` tool call, shown at the start
// of each module instead of the raw "generate_mcqs / Running" tool widget.
export default function QuizPrepCard({
  moduleTitle,
  onShow,
}: {
  moduleTitle?: string;
  onShow?: (moduleTitle: string) => void;
}) {
  // Switching modules: mark this module active so the header updates and the
  // previous module's answered questions collapse.
  useEffect(() => {
    if (moduleTitle) onShow?.(moduleTitle);
  }, [moduleTitle, onShow]);

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
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          border: "2px solid #c3dafe",
          borderTopColor: "#4f46e5",
          borderRadius: "50%",
          animation: "duolearno-spin 0.7s linear infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 14, color: "#4a5568", fontWeight: 500 }}>
        Preparing your questions{moduleTitle ? ` for “${moduleTitle}”` : ""}…
      </span>
      <style>{`@keyframes duolearno-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
