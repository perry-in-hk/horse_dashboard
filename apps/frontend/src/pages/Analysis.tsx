import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { apiFetch } from "../api/client.ts";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface OverviewStats {
  total_race_days: number;
  total_races: number;
  total_horses: number;
  total_jockeys: number;
  earliest_date: string;
  latest_date: string;
}

interface RaceMeeting {
  race_date: string;
  racecourse: string;
  race_count: number;
}

interface Runner {
  horse_no: number;
  horse_name: string;
  horse_code: string;
  jockey: string;
  trainer: string;
  finish_position: string;
  finish_time: string;
  win_odds: number | null;
  draw: number | null;
  position_int: number | null;
  race_score: number;
}

interface HorseRow extends Runner {
  race_date: string;
  racecourse: string;
  race_no: number;
  actual_weight: number | null;
  declared_weight: number | null;
  margin: string | null;
  running_positions: string | null;
}

interface JockeyStat {
  jockey: string;
  total_races: number;
  wins: number;
  top3: number;
  win_rate: string;
  top3_rate: string;
  avg_win_odds: string;
}

interface SearchResult {
  horse_code: string;
  horse_name: string;
  race_count: number;
}

/* ── Component ───────────────────────────────────────────────────────────── */

export default function Analysis() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [meetings, setMeetings] = useState<RaceMeeting[]>([]);

  // Race drill-down
  const [selectedMeeting, setSelectedMeeting] = useState<string>("");
  const [runners, setRunners] = useState<Runner[]>([]);

  // Horse search + history
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [horseList, setHorseList] = useState<SearchResult[]>([]);
  const [selectedHorse, setSelectedHorse] = useState<{ code: string; name: string } | null>(null);
  const [horseHistory, setHorseHistory] = useState<HorseRow[]>([]);

  // Jockey performance
  const [minRaces, setMinRaces] = useState(10);
  const [jockeyStats, setJockeyStats] = useState<JockeyStat[]>([]);

  // Mode
  const [mode, setMode] = useState<"race" | "horse" | "jockey">("race");

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ── Initial load ────────────────────────────────────────────────────── */

  useEffect(() => {
    apiFetch<OverviewStats>("/api/analytics/meta/overview").then(setOverview).catch(() => {});
    apiFetch<RaceMeeting[]>("/api/analytics/meta/race-dates").then(setMeetings).catch(() => {});
    apiFetch<JockeyStat[]>(`/api/analytics/jockey-performance?min_races=10&limit=50`).then(setJockeyStats).catch(() => {});
    apiFetch<SearchResult[]>("/api/analytics/horses/list?limit=8000").then(setHorseList).catch(() => {});
  }, []);

  /* ── Race drill-down ─────────────────────────────────────────────────── */

  useEffect(() => {
    if (!selectedMeeting) {
      setRunners([]);
      return;
    }
    const [date, course] = selectedMeeting.split("|");
    const meeting = meetings.find((m) => m.race_date === date && m.racecourse === course);
    if (!meeting) return;

    // Fetch all races in this meeting
    const promises = Array.from({ length: meeting.race_count }, (_, i) =>
      apiFetch<Runner[]>(`/api/analytics/race/${date}/${course}/${i + 1}/runners`).catch(() => [])
    );
    Promise.all(promises).then((all) => setRunners(all.flat()));
  }, [selectedMeeting, meetings]);

  /* ── Horse search ────────────────────────────────────────────────────── */

  const onSearchInput = useCallback((q: string) => {
    setSearchQ(q);
    clearTimeout(searchTimer.current);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      apiFetch<SearchResult[]>(`/api/analytics/horses/search?q=${encodeURIComponent(q)}`).then(setSearchResults).catch(() => {});
    }, 300);
  }, []);

  const selectHorse = useCallback((code: string, name: string) => {
    setSelectedHorse({ code, name });
    setSearchResults([]);
    setSearchQ(name);
    apiFetch<HorseRow[]>(`/api/analytics/horses/${code}/history`).then(setHorseHistory).catch(() => {});
    setMode("horse");
  }, []);

  /* ── Refresh jockey stats when minRaces changes ──────────────────────── */

  useEffect(() => {
    apiFetch<JockeyStat[]>(`/api/analytics/jockey-performance?min_races=${minRaces}&limit=50`)
      .then(setJockeyStats)
      .catch(() => {});
  }, [minRaces]);

  /* ── Chart options: Horse score time-series ─────────────────────────── */

  const horseChartOpt = useMemo(() => {
    if (!horseHistory.length) return null;
    const dates = horseHistory.map((r) => r.race_date);
    const scores = horseHistory.map((r) => r.race_score);
    const champIdx = horseHistory.reduce<number[]>((acc, r, i) => {
      if (r.position_int === 1) acc.push(i);
      return acc;
    }, []);

    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" as const },
      xAxis: { type: "category" as const, data: dates, axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 45 }, axisLine: { lineStyle: { color: "#334155" } } },
      yAxis: { type: "value" as const, name: "Race Score", nameTextStyle: { color: "#94a3b8" }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      series: [
        {
          name: "Score",
          type: "line" as const,
          data: scores,
          smooth: true,
          lineStyle: { color: "#3b82f6" },
          itemStyle: { color: "#3b82f6" },
          symbolSize: 6,
          markPoint: champIdx.length
            ? {
                data: champIdx.map((i) => ({ coord: [dates[i], scores[i]], name: "Win", itemStyle: { color: "#fbbf24" } })),
                symbol: "circle",
                symbolSize: 14,
                label: { show: true, formatter: "W", fontSize: 9, color: "#0f172a" },
              }
            : undefined,
        },
      ],
    };
  }, [horseHistory]);

  /* ── Chart options: Jockey win-rate bar chart ──────────────────────── */

  const jockeyChartOpt = useMemo(() => {
    if (!jockeyStats.length) return null;
    const top20 = jockeyStats.slice(0, 20);
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" as const },
      grid: { left: 120, right: 40, top: 30, bottom: 30 },
      xAxis: { type: "value" as const, name: "Win Rate %", axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "#1e293b" } } },
      yAxis: { type: "category" as const, data: top20.map((j) => j.jockey).reverse(), axisLabel: { color: "#94a3b8", fontSize: 11 }, axisLine: { lineStyle: { color: "#334155" } } },
      series: [
        {
          name: "Win Rate",
          type: "bar" as const,
          data: top20.map((j) => Number(j.win_rate)).reverse(),
          itemStyle: { color: "#3b82f6", borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18,
        },
        {
          name: "Top-3 Rate",
          type: "bar" as const,
          data: top20.map((j) => Number(j.top3_rate)).reverse(),
          itemStyle: { color: "#22d3ee", borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18,
        },
      ],
    };
  }, [jockeyStats]);

  /* ── Aggregate score for horse cards ───────────────────────────────── */

  const runnersWithAgg = useMemo(() => {
    if (!runners.length) return [];
    const byCode = new Map<string, Runner & { avg_score: number; race_count: number }>();
    for (const r of runners) {
      if (!r.horse_code) continue;
      const existing = byCode.get(r.horse_code);
      if (!existing) {
        byCode.set(r.horse_code, { ...r, avg_score: r.race_score, race_count: 1 });
      } else {
        existing.race_count++;
        existing.avg_score = (existing.avg_score * (existing.race_count - 1) + r.race_score) / existing.race_count;
      }
    }
    return Array.from(byCode.values()).sort((a, b) => b.avg_score - a.avg_score);
  }, [runners]);

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div>
      {/* Overview stats */}
      {overview && (
        <div className="stat-row">
          <div className="stat-pill"><span className="label">Race Days</span><span className="value">{overview.total_race_days}</span></div>
          <div className="stat-pill"><span className="label">Races</span><span className="value">{overview.total_races}</span></div>
          <div className="stat-pill"><span className="label">Horses</span><span className="value">{overview.total_horses}</span></div>
          <div className="stat-pill"><span className="label">Jockeys</span><span className="value">{overview.total_jockeys}</span></div>
          <div className="stat-pill"><span className="label">Date Range</span><span className="value" style={{ fontSize: 14 }}>{overview.earliest_date?.slice(0, 10)} — {overview.latest_date?.slice(0, 10)}</span></div>
        </div>
      )}

      {/* Controls */}
      <div className="controls">
        <button className={`btn ${mode === "race" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("race")}>Race View</button>
        <button className={`btn ${mode === "horse" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("horse")}>Horse View</button>
        <button className={`btn ${mode === "jockey" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("jockey")}>Jockey View</button>

        <span style={{ width: 1, height: 28, background: "#334155" }} />

        {mode === "race" && (
          <>
            <label>Meeting</label>
            <select value={selectedMeeting} onChange={(e) => setSelectedMeeting(e.target.value)}>
              <option value="">Select a meeting...</option>
              {meetings.map((m) => (
                <option key={`${m.race_date}|${m.racecourse}`} value={`${m.race_date}|${m.racecourse}`}>
                  {m.race_date.slice(0, 10)} {m.racecourse} ({m.race_count}R)
                </option>
              ))}
            </select>
          </>
        )}

        {mode === "horse" && (
          <>
            <label htmlFor="horse-dropdown">Horse</label>
            <select
              id="horse-dropdown"
              className="select-horse"
              value={selectedHorse?.code ?? ""}
              onChange={(e) => {
                const code = e.target.value;
                if (!code) {
                  setSelectedHorse(null);
                  setHorseHistory([]);
                  setSearchQ("");
                  return;
                }
                const h = horseList.find((x) => x.horse_code === code);
                if (h) selectHorse(h.horse_code, h.horse_name);
              }}
            >
              <option value="">Select a horse…</option>
              {horseList.map((h) => (
                <option key={h.horse_code} value={h.horse_code}>
                  {h.horse_name} ({h.horse_code}) — {h.race_count} starts
                </option>
              ))}
            </select>
            <div className="search-box">
              <input placeholder="Or search name / code…" value={searchQ} onChange={(e) => onSearchInput(e.target.value)} />
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((r) => (
                    <div key={r.horse_code} className="sr-item" onClick={() => selectHorse(r.horse_code, r.horse_name)}>
                      <span>{r.horse_name}</span>
                      <span style={{ color: "#64748b" }}>{r.horse_code} ({r.race_count})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {mode === "jockey" && (
          <>
            <label>Min Races</label>
            <input type="number" value={minRaces} min={1} max={500} style={{ width: 70 }} onChange={(e) => setMinRaces(Number(e.target.value) || 1)} />
          </>
        )}
      </div>

      {/* ── Race view ──────────────────────────────────────────────────── */}
      {mode === "race" && (
        <>
          {runners.length > 0 && (
            <>
              <div className="horse-cards">
                {runnersWithAgg.map((r) => (
                  <div key={r.horse_code} className="horse-card" onClick={() => selectHorse(r.horse_code, r.horse_name)} style={{ cursor: "pointer" }}>
                    <div className="horse-card-header">
                      <div>
                        <div className="horse-card-name">{r.horse_name}</div>
                        <div className="horse-card-meta">
                          <span>Code: {r.horse_code}</span>
                          <span>Jockey: {r.jockey}</span>
                          <span>Draw: {r.draw ?? "-"}</span>
                        </div>
                      </div>
                      <div className="horse-card-score">{r.avg_score.toFixed(1)}</div>
                    </div>
                    <div className="horse-card-meta">
                      <span>Pos: {r.finish_position ?? "-"}</span>
                      <span>Odds: {r.win_odds ?? "-"}</span>
                      <span>Time: {r.finish_time ?? "-"}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card full-span" style={{ marginTop: 20 }}>
                <h3 className="card-title">Race Results</h3>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Horse</th><th>Code</th><th>Jockey</th><th>Pos</th><th>Score</th><th>Odds</th><th>Draw</th><th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runners.map((r, i) => (
                        <tr key={i} className={r.position_int === 1 ? "champion" : ""}>
                          <td>{r.horse_no}</td>
                          <td>{r.horse_name}</td>
                          <td>{r.horse_code}</td>
                          <td>{r.jockey}</td>
                          <td>{r.finish_position}</td>
                          <td>{r.race_score}</td>
                          <td>{r.win_odds ?? "-"}</td>
                          <td>{r.draw ?? "-"}</td>
                          <td>{r.finish_time ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {!runners.length && selectedMeeting && <p style={{ color: "#64748b" }}>No results for this meeting yet.</p>}
          {!selectedMeeting && <p style={{ color: "#64748b" }}>Select a meeting above to view race results and horse cards.</p>}
        </>
      )}

      {/* ── Horse view ─────────────────────────────────────────────────── */}
      {mode === "horse" && (
        <>
          {selectedHorse && horseHistory.length > 0 && (
            <>
              <div className="stat-row">
                <div className="stat-pill"><span className="label">Horse</span><span className="value" style={{ fontSize: 16 }}>{selectedHorse.name}</span></div>
                <div className="stat-pill"><span className="label">Races</span><span className="value">{horseHistory.length}</span></div>
                <div className="stat-pill"><span className="label">Wins</span><span className="value">{horseHistory.filter((r) => r.position_int === 1).length}</span></div>
                <div className="stat-pill">
                  <span className="label">Avg Score</span>
                  <span className="value">{(horseHistory.reduce((s, r) => s + r.race_score, 0) / horseHistory.length).toFixed(2)}</span>
                </div>
              </div>

              {horseChartOpt && (
                <div className="chart-wrapper" style={{ marginBottom: 20 }}>
                  <h3 className="card-title">Score Over Time (gold = win)</h3>
                  <ReactECharts option={horseChartOpt} style={{ height: 340 }} />
                </div>
              )}

              <div className="card">
                <h3 className="card-title">Race History</h3>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th><th>Course</th><th>R#</th><th>Pos</th><th>Score</th><th>Jockey</th><th>Odds</th><th>Draw</th><th>Time</th><th>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {horseHistory.map((r, i) => (
                        <tr key={i} className={r.position_int === 1 ? "champion" : ""}>
                          <td>{r.race_date?.slice(0, 10)}</td>
                          <td>{r.racecourse}</td>
                          <td>{r.race_no}</td>
                          <td>{r.finish_position}</td>
                          <td>{r.race_score}</td>
                          <td>{r.jockey}</td>
                          <td>{r.win_odds ?? "-"}</td>
                          <td>{r.draw ?? "-"}</td>
                          <td>{r.finish_time ?? "-"}</td>
                          <td>{r.margin ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {!selectedHorse && <p style={{ color: "#64748b" }}>Search for a horse above to see its performance history and score trend.</p>}
        </>
      )}

      {/* ── Jockey view ────────────────────────────────────────────────── */}
      {mode === "jockey" && (
        <>
          {jockeyChartOpt && (
            <div className="chart-wrapper" style={{ marginBottom: 20 }}>
              <h3 className="card-title">Top Jockeys: Win Rate vs Top-3 Rate</h3>
              <ReactECharts option={jockeyChartOpt} style={{ height: 500 }} />
            </div>
          )}

          <div className="card">
            <h3 className="card-title">Jockey Statistics (min {minRaces} races)</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Jockey</th><th>Races</th><th>Wins</th><th>Top 3</th><th>Win %</th><th>Top-3 %</th><th>Avg Odds</th>
                  </tr>
                </thead>
                <tbody>
                  {jockeyStats.map((j) => (
                    <tr key={j.jockey}>
                      <td>{j.jockey}</td>
                      <td>{j.total_races}</td>
                      <td>{j.wins}</td>
                      <td>{j.top3}</td>
                      <td>{j.win_rate}%</td>
                      <td>{j.top3_rate}%</td>
                      <td>{j.avg_win_odds ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
