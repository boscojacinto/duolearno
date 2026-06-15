"use client";

// A horizontal break between modules in the quiz stream, so the start of each
// new module is visually obvious as you scroll the chat history.
export default function ModuleDivider({
  title,
  index,
  totalModules,
}: {
  title: string;
  index: number;
  totalModules?: number;
}) {
  const label =
    index >= 0
      ? `Module ${index + 1}${totalModules ? ` of ${totalModules}` : ""}: ${title}`
      : title;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "24px 0 8px",
        maxWidth: 640,
      }}
    >
      <span style={{ flex: 1, height: 1, background: "#cbd5e0" }} />
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#4338ca",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: "#cbd5e0" }} />
    </div>
  );
}
