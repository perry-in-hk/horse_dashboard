import { useMemo, useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Local calendar day → YYYY-MM-DD */
export function localYmd(y: number, m0: number, d: number) {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

type Props = {
  value: string[];
  onChange: (dates: string[]) => void;
  disabled?: boolean;
};

/**
 * Month grid: click days to toggle selection. Value is sorted unique ISO dates (local).
 */
export default function MultiDateCalendar({ value, onChange, disabled }: Props) {
  const selected = useMemo(() => new Set(value), [value]);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m0: n.getMonth() };
  });

  const { y, m0 } = cursor;
  const firstDow = new Date(y, m0, 1).getDay();
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const monthLabel = new Date(y, m0, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

  function toggleDay(d: number) {
    if (disabled) return;
    const key = localYmd(y, m0, d);
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next].sort());
  }

  function goMonth(delta: number) {
    const d = new Date(y, m0 + delta, 1);
    setCursor({ y: d.getFullYear(), m0: d.getMonth() });
  }

  const today = new Date();
  const isToday = (d: number) =>
    today.getFullYear() === y && today.getMonth() === m0 && today.getDate() === d;

  return (
    <div style={{ maxWidth: 320 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "4px 10px", minWidth: 36 }}
          disabled={disabled}
          onClick={() => goMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{monthLabel}</span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "4px 10px", minWidth: 36 }}
          disabled={disabled}
          onClick={() => goMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          textAlign: "center",
          fontSize: 11,
          color: "#64748b",
          marginBottom: 6,
        }}
      >
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ padding: "2px 0" }}>
            {w}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {cells.map((d, i) => {
          if (d === null) {
            return <div key={`e-${i}`} />;
          }
          const key = localYmd(y, m0, d);
          const on = selected.has(key);
          const todayRing = isToday(d);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => toggleDay(d)}
              style={{
                aspectRatio: "1",
                minHeight: 36,
                borderRadius: 8,
                border: todayRing ? "1px solid rgba(96, 165, 250, 0.6)" : "1px solid transparent",
                background: on ? "rgba(59, 130, 246, 0.35)" : "rgba(15, 23, 42, 0.8)",
                color: "#e2e8f0",
                fontSize: 13,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
        >
          Clear dates
        </button>
        {value.length > 0 && (
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {value.length} date{value.length === 1 ? "" : "s"} selected
          </span>
        )}
      </div>
    </div>
  );
}
