import React from "react";

const COLORS = {
  LOW: "#166534", NORMAL: "#1d4ed8", HIGH: "#92400e", CRITICAL: "#991b1b",
  EXCELLENT: "#166534", GOOD: "#1d4ed8", NEEDS_ATTENTION: "#92400e", CRITICAL_SCORE: "#991b1b",
};

export default function ProgressBar({ pct, level, height = 10 }) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const color = COLORS[level] || "#1d4ed8";
  return (
    <div style={{ background: "var(--bg-subtle)", borderRadius: 6, height, width: "100%", overflow: "hidden" }}>
      <div style={{ width: `${clamped}%`, background: color, height: "100%", transition: "width .3s" }} />
    </div>
  );
}
