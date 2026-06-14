"use client";

interface ApprovalCardProps {
  summary: string;
  onApprove: () => void;
  onReject: () => void;
  loading?: boolean;
}

export default function ApprovalCard({ summary, onApprove, onReject, loading }: ApprovalCardProps) {
  return (
    <div style={{
      maxWidth: 720,
      margin: "40px auto",
      padding: "32px",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      background: "#fff",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 22, color: "#1a202c" }}>
        Learning Plan Ready
      </h2>
      <pre style={{
        background: "#f7fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "16px",
        fontSize: 13,
        lineHeight: 1.6,
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        color: "#2d3748",
        marginBottom: 24,
      }}>
        {summary}
      </pre>
      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={onApprove}
          disabled={loading}
          style={{
            padding: "10px 28px",
            background: loading ? "#a0aec0" : "#4f46e5",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Starting quiz…" : "Approve & Start Quiz"}
        </button>
        <button
          onClick={onReject}
          disabled={loading}
          style={{
            padding: "10px 28px",
            background: "transparent",
            color: "#e53e3e",
            border: "1px solid #e53e3e",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
