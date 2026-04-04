import {
  normalizePairKeyFromComb,
  normalizePairKeyFromNumbers,
  pairCellTrend,
  pairTrendStyle,
  type PairCellTrend,
} from "../lib/pairComb.ts";

export type PairPoolType = "QIN" | "QPL";

type CellMeta = {
  odds: number | null;
  trend: PairCellTrend;
};

export default function PairOddsMatrix(props: {
  poolType: PairPoolType;
  fieldSize: number;
  /** pair key "a-b" -> cell data */
  cellData: Map<string, CellMeta>;
  selected: Set<string>;
  onToggle: (pairKey: string) => void;
  onClearSelection: () => void;
}) {
  const { poolType, fieldSize, cellData, selected, onToggle, onClearSelection } = props;
  const title = poolType === "QIN" ? "連贏 (QIN)" : "位置Q (QPL)";
  const n = Math.max(2, Math.min(24, fieldSize));

  const nums = Array.from({ length: n }, (_, i) => i + 1);

  return (
    <div className="pair-odds-matrix-wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 className="card-title" style={{ margin: 0 }}>
          {title}
        </h3>
        <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={onClearSelection}>
          Clear selection
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Click cells to select combinations; timeline below plots selected pairs. Legend: red = hot, green = odds down ≥20%,
        brown = down ≥50%.
      </p>
      <div style={{ overflow: "auto", maxWidth: "100%" }}>
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 12,
            marginTop: 8,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  minWidth: 28,
                  padding: 4,
                  background: "#1e293b",
                  border: "1px solid #475569",
                }}
              />
              {nums.map((j) => (
                <th
                  key={j}
                  style={{
                    minWidth: 44,
                    padding: 4,
                    textAlign: "center",
                    background: "#1e3a5f",
                    color: "#e2e8f0",
                    border: "1px solid #475569",
                  }}
                >
                  {j}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nums.map((i) => (
              <tr key={i}>
                <th
                  style={{
                    padding: 4,
                    textAlign: "center",
                    background: "#1e3a5f",
                    color: "#e2e8f0",
                    border: "1px solid #475569",
                  }}
                >
                  {i}
                </th>
                {nums.map((j) => {
                  if (j <= i) {
                    return (
                      <td
                        key={`${i}-${j}`}
                        style={{
                          background: "#0f172a",
                          border: "1px solid #1e293b",
                          minWidth: 44,
                          height: 32,
                        }}
                      />
                    );
                  }
                  const key = normalizePairKeyFromNumbers(i, j);
                  if (!key) return null;
                  const meta = cellData.get(key);
                  const odds = meta?.odds;
                  const sel = selected.has(key);
                  const st = pairTrendStyle(meta?.trend ?? "neutral");
                  return (
                    <td
                      key={`${i}-${j}`}
                      onClick={() => onToggle(key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onToggle(key);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      style={{
                        ...st,
                        cursor: "pointer",
                        textAlign: "center",
                        padding: "4px 6px",
                        border: sel ? "2px solid #60a5fa" : `1px solid ${String(st.borderColor ?? "#475569")}`,
                        fontWeight: sel ? 700 : 500,
                        color: "#f8fafc",
                        userSelect: "none",
                      }}
                    >
                      {odds != null && Number.isFinite(odds) ? odds : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", fontSize: 11, color: "#94a3b8" }}>
        <span>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(248,113,113,0.5)", marginRight: 4 }} />
          熱門
        </span>
        <span>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(74,222,128,0.25)", marginRight: 4 }} />
          賠率下降 20%
        </span>
        <span>
          <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(180,83,9,0.4)", marginRight: 4 }} />
          賠率下降 50%
        </span>
      </div>
    </div>
  );
}

/** Build cell map from latest + previous pool oddsNodes */
export function buildPairCellMap(
  oddsNodes:
    | { combString?: string; oddsValue?: string | number; hotFavourite?: boolean }[]
    | undefined,
  prevNodes: { combString?: string; oddsValue?: string | number }[] | undefined,
  parseOdds: (v: unknown) => number | null
): Map<string, CellMeta> {
  const prevOdds = new Map<string, number>();
  if (prevNodes) {
    for (const n of prevNodes) {
      const k = normalizePairKeyFromComb(n.combString ?? "");
      if (!k) continue;
      const v = parseOdds(n.oddsValue);
      if (v != null) prevOdds.set(k, v);
    }
  }
  const map = new Map<string, CellMeta>();
  if (!oddsNodes) return map;
  for (const n of oddsNodes) {
    const key = normalizePairKeyFromComb(n.combString ?? "");
    if (!key) continue;
    const odds = parseOdds(n.oddsValue);
    const prev = prevOdds.get(key) ?? null;
    const trend = pairCellTrend({
      oddsNow: odds,
      oddsPrev: prev,
      hotFavourite: Boolean(n.hotFavourite),
    });
    map.set(key, { odds, trend });
  }
  return map;
}
