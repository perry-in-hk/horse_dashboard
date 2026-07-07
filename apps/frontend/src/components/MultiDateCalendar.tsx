import { useMemo, useState } from "react";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

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

  const monthLabel = new Date(y, m0, 1).toLocaleString("zh-HK", { month: "long", year: "numeric" });

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
    <div className="multi-date-calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="btn btn-ghost calendar-nav-btn"
          disabled={disabled}
          onClick={() => goMonth(-1)}
          aria-label="上個月"
        >
          ‹
        </button>
        <span className="calendar-month">{monthLabel}</span>
        <button
          type="button"
          className="btn btn-ghost calendar-nav-btn"
          disabled={disabled}
          onClick={() => goMonth(1)}
          aria-label="下個月"
        >
          ›
        </button>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday-cell">
            {w}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
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
              className={`calendar-day${on ? " selected" : ""}${todayRing ? " today" : ""}${disabled ? " disabled" : ""}`}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div className="calendar-footer">
        <button
          type="button"
          className="btn btn-ghost calendar-clear-btn"
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
        >
          清除日期
        </button>
        {value.length > 0 && (
          <span className="muted calendar-summary">
            已選擇 {value.length} 日
          </span>
        )}
      </div>
    </div>
  );
}
