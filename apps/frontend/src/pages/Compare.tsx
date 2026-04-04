import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { apiFetch } from "../api/client.ts";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface SearchResult {
  horse_code: string;
  horse_name: string;
  race_count: number;
}

interface RaceRow {
  race_date: string;
  racecourse: string;
  race_no: number;
  horse_name: string;
  horse_code: string;
  jockey: string;
  trainer: string;
  finish_position: string;
  finish_time: string;
  win_odds: number | null;
  draw: number | null;
  actual_weight: number | null;
  declared_weight: number | null;
  margin: string | null;
  running_positions: string | null;
  race_distance: number | null;
  time_seconds: number | null;
  speed_mps: number | null;
  position_int: number | null;
  race_score: number;
}

interface VenueSplit {
  [course: string]: { starts: number; wins: number };
}

interface Summary {
  starts: number;
  wins: number;
  top3: number;
  win_rate: number;
  top3_rate: number;
  avg_position: number | null;
  avg_odds: number | null;
  avg_score: number;
  avg_draw: number | null;
  venue_split: VenueSplit;
}

interface HorseCompare {
  horse_code: string;
  horse_name: string;
  rows: RaceRow[];
  summary: Summary;
}

interface CompareResponse {
  horses: HorseCompare[];
}

const SERIES_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

/* ── Component ───────────────────────────────────────────────────────────── */

export default function Compare() {
  const [selected, setSelected] = useState<{ code: string; name: string }[]>([]);
  const [horseList, setHorseList] = useState<SearchResult[]>([]);
  const [listPick, setListPick] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [data, setData] = useState<HorseCompare[]>([]);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    apiFetch<SearchResult[]>("/api/analytics/horses/list?limit=8000").then(setHorseList).catch(() => {});
  }, []);

  /* ── Search ──────────────────────────────────────────────────────────── */

  const onSearchInput = useCallback(
    (q: string) => {
      setSearchQ(q);
      clearTimeout(searchTimer.current);
      if (q.length < 2) {
        setSearchResults([]);
        return;
      }
      searchTimer.current = setTimeout(() => {
        apiFetch<SearchResult[]>(`/api/analytics/horses/search?q=${encodeURIComponent(q)}`)
          .then((r) => setSearchResults(r.filter((h) => !selected.some((s) => s.code === h.horse_code))))
          .catch(() => {});
      }, 300);
    },
    [selected],
  );

  const addHorse = useCallback(
    (code: string, name: string) => {
      if (selected.length >= 6 || selected.some((s) => s.code === code)) return;
      setSelected((prev) => [...prev, { code, name }]);
      setSearchQ("");
      setSearchResults([]);
    },
    [selected],
  );

  const removeHorse = useCallback((code: string) => {
    setSelected((prev) => prev.filter((s) => s.code !== code));
    setData((prev) => prev.filter((h) => h.horse_code !== code));
  }, []);

  /* ── Fetch comparison ────────────────────────────────────────────────── */

  const fetchCompare = useCallback(async () => {
    if (selected.length === 0) return;
    setLoading(true);
    try {
      const codes = selected.map((s) => s.code).join(",");
      const resp = await apiFetch<CompareResponse>(`/api/analytics/horses/compare?codes=${codes}`);
      setData(resp.horses);
    } catch {
      /* toast / ignore */
    } finally {
      setLoading(false);
    }
  }, [selected]);

  /* ── Chart helpers ───────────────────────────────────────────────────── */

  const allDates = useMemo(() => {
    const set = new Set<string>();
    for (const h of data) for (const r of h.rows) set.add(r.race_date);
    return Array.from(set).sort();
  }, [data]);

  function makeTimeSeries(accessor: (r: RaceRow) => number | null) {
    return data.map((h, i) => {
      const byDate = new Map<string, number[]>();
      for (const r of h.rows) {
        const v = accessor(r);
        if (v == null) continue;
        const d = r.race_date;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(v);
      }
      return {
        name: `${h.horse_name} (${h.horse_code})`,
        type: "line" as const,
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        connectNulls: true,
        lineStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        data: allDates.map((d) => {
          const vals = byDate.get(d);
          if (!vals) return null;
          return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
        }),
      };
    });
  }

  const scoreChart = useMemo(() => {
    if (!data.length) return null;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" as const },
      legend: { textStyle: { color: "#94a3b8" }, top: 0 },
      xAxis: { type: "category" as const, data: allDates, axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 45 }, axisLine: { lineStyle: { color: "#334155" } } },
      yAxis: { type: "value" as const, name: "Score", nameTextStyle: { color: "#94a3b8" }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      series: makeTimeSeries((r) => r.race_score),
    };
  }, [data, allDates]);

  const oddsChart = useMemo(() => {
    if (!data.length) return null;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" as const },
      legend: { textStyle: { color: "#94a3b8" }, top: 0 },
      xAxis: { type: "category" as const, data: allDates, axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 45 }, axisLine: { lineStyle: { color: "#334155" } } },
      yAxis: { type: "value" as const, name: "Win Odds", nameTextStyle: { color: "#94a3b8" }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      series: makeTimeSeries((r) => (r.win_odds != null ? Number(r.win_odds) : null)),
    };
  }, [data, allDates]);

  const posChart = useMemo(() => {
    if (!data.length) return null;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" as const },
      legend: { textStyle: { color: "#94a3b8" }, top: 0 },
      xAxis: { type: "category" as const, data: allDates, axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 45 }, axisLine: { lineStyle: { color: "#334155" } } },
      yAxis: { type: "value" as const, name: "Finish Pos", inverse: true, min: 1, nameTextStyle: { color: "#94a3b8" }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      series: makeTimeSeries((r) => r.position_int),
    };
  }, [data, allDates]);

  /* Draw vs position scatter */
  const drawChart = useMemo(() => {
    if (!data.length) return null;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "item" as const, formatter: (p: { seriesName: string; data: number[] }) => `${p.seriesName}<br/>Draw ${p.data[0]} → Pos ${p.data[1]}` },
      legend: { textStyle: { color: "#94a3b8" }, top: 0 },
      xAxis: { type: "value" as const, name: "Draw", nameTextStyle: { color: "#94a3b8" }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      yAxis: { type: "value" as const, name: "Finish Pos", inverse: true, min: 1, nameTextStyle: { color: "#94a3b8" }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      series: data.map((h, i) => ({
        name: `${h.horse_name}`,
        type: "scatter" as const,
        symbolSize: 8,
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        data: h.rows.filter((r) => r.draw != null && r.position_int != null).map((r) => [r.draw, r.position_int]),
      })),
    };
  }, [data]);

  /* Average speed by race distance (grouped bars) */
  const speedByDistanceChart = useMemo(() => {
    if (!data.length) return null;
    const distSet = new Set<number>();
    for (const h of data) {
      for (const r of h.rows) {
        if (r.race_distance != null && r.speed_mps != null) distSet.add(Number(r.race_distance));
      }
    }
    const distances = Array.from(distSet).sort((a, b) => a - b);
    if (distances.length === 0) return null;
    const categories = distances.map((d) => `${d}m`);

    const series = data.map((h, i) => {
      const byDist = new Map<number, number[]>();
      for (const r of h.rows) {
        if (r.race_distance == null || r.speed_mps == null) continue;
        const d = Number(r.race_distance);
        if (!byDist.has(d)) byDist.set(d, []);
        byDist.get(d)!.push(r.speed_mps);
      }
      return {
        name: `${h.horse_name} (${h.horse_code})`,
        type: "bar" as const,
        emphasis: { focus: "series" as const },
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        data: distances.map((d) => {
          const vals = byDist.get(d);
          if (!vals?.length) return null;
          const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
          const value = Math.round(avg * 10000) / 10000;
          return { value, n: vals.length, distanceM: d };
        }),
      };
    });

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (params: unknown) => {
          const ps = (Array.isArray(params) ? params : [params]) as {
            axisValue?: string;
            seriesName?: string;
            data?: { value: number; n: number; distanceM: number } | null;
            marker?: string;
          }[];
          const axis = ps[0]?.axisValue ?? "";
          const lines = [axis];
          for (const p of ps) {
            const d = p.data;
            if (d == null || typeof d !== "object" || d.value == null) continue;
            lines.push(
              `${p.marker ?? ""} ${p.seriesName ?? ""}: ${d.value} m/s (${d.n} start${d.n === 1 ? "" : "s"})`,
            );
          }
          return lines.join("<br/>");
        },
      },
      legend: { textStyle: { color: "#94a3b8" }, top: 0 },
      grid: { left: 48, right: 16, top: 40, bottom: 48 },
      xAxis: {
        type: "category" as const,
        data: categories,
        name: "Distance",
        nameTextStyle: { color: "#94a3b8" },
        axisLabel: { color: "#94a3b8", fontSize: 11 },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      yAxis: {
        type: "value" as const,
        name: "m/s",
        nameTextStyle: { color: "#94a3b8" },
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      series,
    };
  }, [data]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700 }}>Horse Comparison</h2>

      {/* Dropdown + search + chips */}
      <div className="controls">
        <label htmlFor="compare-horse-list">Horse</label>
        <select
          id="compare-horse-list"
          className="select-horse"
          value={listPick}
          disabled={selected.length >= 6}
          onChange={(e) => {
            const code = e.target.value;
            setListPick("");
            if (!code) return;
            const h = horseList.find((x) => x.horse_code === code);
            if (h) addHorse(h.horse_code, h.horse_name);
          }}
        >
          <option value="">Add horse from list…</option>
          {horseList
            .filter((h) => !selected.some((s) => s.code === h.horse_code))
            .map((h) => (
              <option key={h.horse_code} value={h.horse_code}>
                {h.horse_name} ({h.horse_code}) — {h.race_count} starts
              </option>
            ))}
        </select>

        <div className="search-box">
          <input
            placeholder="Or search name / code…"
            value={searchQ}
            onChange={(e) => onSearchInput(e.target.value)}
            disabled={selected.length >= 6}
          />
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((r) => (
                <div key={r.horse_code} className="sr-item" onClick={() => addHorse(r.horse_code, r.horse_name)}>
                  <span>{r.horse_name}</span>
                  <span style={{ color: "#64748b" }}>{r.horse_code} ({r.race_count})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-primary" onClick={fetchCompare} disabled={selected.length === 0 || loading}>
          {loading ? "Loading..." : "Compare"}
        </button>

        <span style={{ fontSize: 12, color: "#64748b" }}>{selected.length}/6 selected</span>
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {selected.map((s, i) => (
            <span
              key={s.code}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: SERIES_COLORS[i % SERIES_COLORS.length] + "22",
                color: SERIES_COLORS[i % SERIES_COLORS.length],
                border: `1px solid ${SERIES_COLORS[i % SERIES_COLORS.length]}44`,
              }}
            >
              {s.name} ({s.code})
              <span onClick={() => removeHorse(s.code)} style={{ cursor: "pointer", opacity: 0.7, fontSize: 15, lineHeight: 1 }}>
                x
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Summary cards */}
      {data.length > 0 && (
        <div className="card" style={{ marginBottom: 20, overflowX: "auto" }}>
          <h3 className="card-title">Summary</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Horse</th>
                <th>Starts</th>
                <th>Wins</th>
                <th>Top 3</th>
                <th>Win %</th>
                <th>Top-3 %</th>
                <th>Avg Pos</th>
                <th>Avg Odds</th>
                <th>Avg Score</th>
                <th>Avg Draw</th>
                <th>Venues</th>
              </tr>
            </thead>
            <tbody>
              {data.map((h, i) => (
                <tr key={h.horse_code}>
                  <td style={{ color: SERIES_COLORS[i % SERIES_COLORS.length], fontWeight: 700 }}>{h.horse_name}</td>
                  <td>{h.summary.starts}</td>
                  <td>{h.summary.wins}</td>
                  <td>{h.summary.top3}</td>
                  <td>{h.summary.win_rate}%</td>
                  <td>{h.summary.top3_rate}%</td>
                  <td>{h.summary.avg_position ?? "—"}</td>
                  <td>{h.summary.avg_odds ?? "—"}</td>
                  <td>{h.summary.avg_score}</td>
                  <td>{h.summary.avg_draw ?? "—"}</td>
                  <td>
                    {Object.entries(h.summary.venue_split)
                      .map(([c, v]) => `${c}: ${v.wins}/${v.starts}`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Charts */}
      {data.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          {scoreChart && (
            <div className="chart-wrapper">
              <h3 className="card-title">Race Score Over Time</h3>
              <ReactECharts option={scoreChart} style={{ height: 320 }} />
            </div>
          )}
          {oddsChart && (
            <div className="chart-wrapper">
              <h3 className="card-title">Win Odds Over Time</h3>
              <ReactECharts option={oddsChart} style={{ height: 320 }} />
            </div>
          )}
          {posChart && (
            <div className="chart-wrapper">
              <h3 className="card-title">Finish Position Over Time</h3>
              <ReactECharts option={posChart} style={{ height: 320 }} />
            </div>
          )}
          {drawChart && (
            <div className="chart-wrapper">
              <h3 className="card-title">Draw vs Finish Position</h3>
              <ReactECharts option={drawChart} style={{ height: 320 }} />
            </div>
          )}
        </div>
      )}

      {data.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="card-title">Average Speed by Race Distance</h3>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>
            Uses merged history distance and finish time. Races without a matched distance or parseable time are omitted.
          </p>
          {speedByDistanceChart ? (
            <div className="chart-wrapper">
              <ReactECharts option={speedByDistanceChart} style={{ height: 360 }} />
            </div>
          ) : (
            <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
              No speed-by-distance data for the selected horses (need history distance and a valid finish time per start).
            </p>
          )}
        </div>
      )}

      {!data.length && selected.length > 0 && (
        <p style={{ color: "#64748b" }}>Click "Compare" to load data for the selected horses.</p>
      )}

      {selected.length === 0 && (
        <p style={{ color: "#64748b" }}>Search and select 1–6 horses above to compare their performance side-by-side.</p>
      )}
    </div>
  );
}
