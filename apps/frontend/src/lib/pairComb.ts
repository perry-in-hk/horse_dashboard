import type { CSSProperties } from "react";

/** Parse HKJC-style combination strings for QIN/QPL (unordered pair). */
export function parsePairComb(comb: string | undefined | null): { a: number; b: number } | null {
  if (comb == null || String(comb).trim() === "") return null;
  const s = String(comb).trim();
  const m =
    s.match(/^(\d+)\s*[-x×,，/]\s*(\d+)$/i) ||
    s.match(/^(\d+)\s+(\d+)$/) ||
    s.match(/(\d+)\s*[-x×,，]\s*(\d+)/);
  if (!m) return null;
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return null;
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

export function normalizePairKeyFromComb(comb: string | undefined | null): string | null {
  const p = parsePairComb(comb);
  if (!p) return null;
  return `${p.a}-${p.b}`;
}

export function normalizePairKeyFromNumbers(i: number, j: number): string | null {
  if (!Number.isFinite(i) || !Number.isFinite(j) || i === j) return null;
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  return `${a}-${b}`;
}

export type PairCellTrend = "neutral" | "hot" | "drop20" | "drop50";

export function pairCellTrend(args: {
  oddsNow: number | null;
  oddsPrev: number | null;
  hotFavourite?: boolean;
}): PairCellTrend {
  const { oddsNow, oddsPrev, hotFavourite } = args;
  if (oddsNow != null && oddsPrev != null && oddsPrev > 0) {
    const drop = (oddsPrev - oddsNow) / oddsPrev;
    if (drop >= 0.5) return "drop50";
    if (drop >= 0.2) return "drop20";
  }
  if (hotFavourite) return "hot";
  return "neutral";
}

/** CSS-friendly background for matrix cells (dark theme). */
export function pairTrendStyle(trend: PairCellTrend): CSSProperties {
  switch (trend) {
    case "hot":
      return { background: "var(--pair-hot-bg)", borderColor: "var(--pair-hot-border)" };
    case "drop20":
      return { background: "var(--pair-drop20-bg)", borderColor: "var(--pair-drop20-border)" };
    case "drop50":
      return { background: "var(--pair-drop50-bg)", borderColor: "var(--pair-drop50-border)" };
    default:
      return { background: "var(--bg-muted)", borderColor: "var(--border-focus)" };
  }
}
