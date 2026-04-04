import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import PairOddsMatrix, { buildPairCellMap, type PairPoolType } from "../components/PairOddsMatrix.tsx";
import { normalizePairKeyFromComb } from "../lib/pairComb.ts";
import { apiFetch } from "../api/client.ts";

const LS_REFRESH_KEY = "hkjc_realtime_refresh_ms";
const REFRESH_CHOICES_MS = [5000, 10000, 15000, 30000, 60000] as const;
const DEFAULT_REFRESH_MS = 10000;
const MAX_CHART_SERIES = 18;
const MAX_PAIR_TIMELINE_SERIES = 12;

const POOL_OPTIONS = ["WIN", "PLA", "QIN", "QPL", "FCT", "TCE", "TRI", "FF", "QTT", "DBL"] as const;

type PoolOption = (typeof POOL_OPTIONS)[number];

interface ActiveRace {
  no?: string;
  status?: string;
  postTime?: string;
  wageringFieldSize?: number;
}

interface ActiveMeeting {
  id?: string;
  date?: string;
  venueCode?: string;
  races?: ActiveRace[];
}

interface OddsNode {
  combString?: string;
  oddsValue?: string | number;
  hotFavourite?: boolean;
  oddsDropValue?: string | number;
}

interface PmPool {
  oddsType?: string;
  oddsNodes?: OddsNode[];
  lastUpdateTime?: string;
}

interface SnapshotRow {
  id: number;
  observed_at: string;
  meeting_date: string;
  venue_code: string;
  race_no: number;
  odds_types: string[];
  payload: PmPool[];
}

interface MeetingsResponse {
  meetings: ActiveMeeting[];
}

interface HistoryResponse {
  snapshots: SnapshotRow[];
}

interface SnapshotCountsResponse {
  counts: { race_no: number; n: number }[];
}

interface SettingsResponse {
  workerIntervalMs: number;
  oddsSyncEnabled: boolean;
}

interface StatusResponse {
  oddsSyncEnabled: boolean;
  workerIntervalMs: number;
  lastSync: {
    at: string;
    result: { meetings?: number; racesChecked?: number; inserted?: number } | null;
    error: string | null;
  } | null;
  legacyFullInterval?: boolean;
  /** All races armed for server interval sync (multi-race). */
  activeIntervalTargets?: SyncRaceKey[] | null;
  /** First armed race; same as activeIntervalTargets?.[0] */
  activeIntervalTarget?: SyncRaceKey | null;
  currentSync?: {
    kind: "interval" | "full";
    meeting_date: string;
    venue_code: string;
    race_no: number;
  } | null;
  syncInProgress?: boolean;
}

type SyncRaceKey = { meeting_date: string; venue_code: string; race_no: number };

function syncRaceKeysMatch(a: SyncRaceKey | null | undefined, b: SyncRaceKey | null | undefined): boolean {
  if (!a || !b) return false;
  return a.meeting_date === b.meeting_date && a.venue_code === b.venue_code && a.race_no === b.race_no;
}

function armedIntervalList(status: StatusResponse): SyncRaceKey[] {
  const multi = status.activeIntervalTargets;
  if (multi && multi.length) return multi;
  if (status.activeIntervalTarget) return [status.activeIntervalTarget];
  return [];
}

/** Live fetch for one of the armed interval races (not a full-sweep pass on another race). */
function isFetchingArmedIntervalRace(status: StatusResponse): boolean {
  const armed = armedIntervalList(status);
  const cur = status.currentSync;
  if (!armed.length || !cur || cur.kind !== "interval") return false;
  return armed.some((a) => syncRaceKeysMatch(a, cur));
}

function readRefreshMs(): number {
  try {
    const v = localStorage.getItem(LS_REFRESH_KEY);
    if (!v) return DEFAULT_REFRESH_MS;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return DEFAULT_REFRESH_MS;
    const allowed = REFRESH_CHOICES_MS as readonly number[];
    return allowed.includes(n) ? n : DEFAULT_REFRESH_MS;
  } catch {
    return DEFAULT_REFRESH_MS;
  }
}

function parseOddsValue(v: unknown): number | null {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** pg/json may leave payload as a JSON string; GraphQL enums may differ in case */
function normalizePoolsPayload(raw: unknown): PmPool[] {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? (v as PmPool[]) : [];
}

function poolMatches(p: PmPool, oddsType: string) {
  return String(p.oddsType ?? "").toUpperCase() === oddsType.toUpperCase();
}

function buildChartSeriesForSelectedPairCombs(
  snapshots: SnapshotRow[],
  oddsType: string,
  selectedKeys: Set<string>,
  maxSeries: number
) {
  if (selectedKeys.size === 0) return [];
  const byComb = new Map<string, [number, number][]>();
  for (const s of snapshots) {
    const t = new Date(s.observed_at).getTime();
    const pools = normalizePoolsPayload(s.payload);
    const pool = pools.find((p) => poolMatches(p, oddsType));
    if (!pool?.oddsNodes) continue;
    for (const n of pool.oddsNodes) {
      const key = normalizePairKeyFromComb(n.combString ?? "") ?? (n.combString ?? "?");
      if (!selectedKeys.has(key)) continue;
      const v = parseOddsValue(n.oddsValue);
      if (v == null) continue;
      if (!byComb.has(key)) byComb.set(key, []);
      byComb.get(key)!.push([t, v]);
    }
  }
  const entries = [...byComb.entries()].slice(0, maxSeries);
  return entries.map(([name, data]) => ({
    name,
    type: "line" as const,
    showSymbol: data.length <= 3,
    data,
  }));
}

function buildChartSeries(snapshots: SnapshotRow[], oddsType: string, maxSeries: number) {
  const byComb = new Map<string, [number, number][]>();
  for (const s of snapshots) {
    const t = new Date(s.observed_at).getTime();
    const pools = normalizePoolsPayload(s.payload);
    const pool = pools.find((p) => poolMatches(p, oddsType));
    if (!pool?.oddsNodes) continue;
    for (const n of pool.oddsNodes) {
      const key = n.combString ?? "?";
      const v = parseOddsValue(n.oddsValue);
      if (v == null) continue;
      if (!byComb.has(key)) byComb.set(key, []);
      byComb.get(key)!.push([t, v]);
    }
  }
  const entries = [...byComb.entries()].slice(0, maxSeries);
  return entries.map(([name, data]) => ({
    name,
    type: "line" as const,
    showSymbol: false,
    data,
  }));
}

function latestNodesByComb(
  snapshots: SnapshotRow[],
  oddsType: string
): { comb: string; odds: number; prev: number | null }[] {
  if (snapshots.length === 0) return [];
  const last = snapshots[snapshots.length - 1];
  const prevSnap = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  const poolLast = normalizePoolsPayload(last.payload).find((p) => poolMatches(p, oddsType));
  const poolPrev = prevSnap ? normalizePoolsPayload(prevSnap.payload).find((p) => poolMatches(p, oddsType)) : null;

  const mapPrev = new Map<string, number>();
  if (poolPrev?.oddsNodes) {
    for (const n of poolPrev.oddsNodes) {
      const k = n.combString ?? "?";
      const v = parseOddsValue(n.oddsValue);
      if (v != null) mapPrev.set(k, v);
    }
  }

  const rows: { comb: string; odds: number; prev: number | null }[] = [];
  if (poolLast?.oddsNodes) {
    for (const n of poolLast.oddsNodes) {
      const comb = n.combString ?? "?";
      const odds = parseOddsValue(n.oddsValue);
      if (odds == null) continue;
      const prev = mapPrev.has(comb) ? mapPrev.get(comb)! : null;
      rows.push({ comb, odds, prev });
    }
  }
  rows.sort((a, b) => a.comb.localeCompare(b.comb, undefined, { numeric: true }));
  return rows;
}

function inferPairFieldSize(
  meeting: ActiveMeeting | null,
  raceNo: number,
  oddsNodes: { combString?: string }[] | undefined
): number {
  const races = meeting?.races ?? [];
  const race = races.find((r) => parseInt(String(r.no), 10) === raceNo);
  const w = race?.wageringFieldSize;
  if (typeof w === "number" && w > 0) return Math.min(24, Math.max(2, w));
  let max = 0;
  if (oddsNodes) {
    for (const n of oddsNodes) {
      const k = normalizePairKeyFromComb(n.combString ?? "");
      if (!k) continue;
      const [a, b] = k.split("-").map((x) => parseInt(x, 10));
      if (Number.isFinite(a) && Number.isFinite(b)) max = Math.max(max, a, b);
    }
  }
  return Math.min(24, Math.max(2, max || 14));
}

export default function Realtime() {
  const [meetings, setMeetings] = useState<ActiveMeeting[]>([]);
  const [meetingsErr, setMeetingsErr] = useState<string | null>(null);
  const [meetingIdx, setMeetingIdx] = useState(0);
  const [raceNo, setRaceNo] = useState(1);
  const [chartPool, setChartPool] = useState<PoolOption>("WIN");
  const [tablePool, setTablePool] = useState<PoolOption>("WIN");
  const [refreshMs, setRefreshMs] = useState(() => readRefreshMs());
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [intervalSyncLoading, setIntervalSyncLoading] = useState(false);
  /** Race numbers (current meeting) included in server auto-sync when interval is armed. */
  const [intervalSyncRaceNos, setIntervalSyncRaceNos] = useState<number[]>([]);

  const [history, setHistory] = useState<SnapshotRow[]>([]);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [raceSnapshotCounts, setRaceSnapshotCounts] = useState<Record<number, number>>({});
  const [pairSelected, setPairSelected] = useState<Set<string>>(() => new Set());

  const meeting = meetings[meetingIdx] ?? null;
  const meetingDate = meeting?.date ? String(meeting.date).slice(0, 10) : "";
  const venueCode = meeting?.venueCode ? String(meeting.venueCode) : "";

  const loadMeetings = useCallback((): Promise<ActiveMeeting[]> => {
    setMeetingsErr(null);
    return apiFetch<MeetingsResponse>("/api/realtime/meetings")
      .then((r) => {
        const list = r.meetings ?? [];
        setMeetings(list);
        return list;
      })
      .catch((e: Error) => {
        setMeetingsErr(e.message);
        return [];
      });
  }, []);

  const loadSettings = useCallback(() => {
    apiFetch<SettingsResponse>("/api/realtime/settings")
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  const loadStatus = useCallback(() => {
    apiFetch<StatusResponse>("/api/realtime/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const loadRaceSnapshotCounts = useCallback(
    (override?: { meeting_date: string; venue_code: string }) => {
      const md = override?.meeting_date ?? meetingDate;
      const vc = override?.venue_code ?? venueCode;
      if (!md || !vc) {
        setRaceSnapshotCounts({});
        return Promise.resolve();
      }
      const qs = new URLSearchParams({ meeting_date: md, venue_code: vc });
      return apiFetch<SnapshotCountsResponse>(`/api/realtime/snapshot-counts?${qs}`)
        .then((r) => {
          const map: Record<number, number> = {};
          for (const row of r.counts ?? []) {
            map[row.race_no] = row.n;
          }
          setRaceSnapshotCounts(map);
        })
        .catch(() => setRaceSnapshotCounts({}));
    },
    [meetingDate, venueCode]
  );

  useEffect(() => {
    loadMeetings();
    loadSettings();
    loadStatus();
  }, [loadMeetings, loadSettings, loadStatus]);

  useEffect(() => {
    const id = window.setInterval(() => loadStatus(), 2000);
    return () => window.clearInterval(id);
  }, [loadStatus]);

  useEffect(() => {
    loadRaceSnapshotCounts();
  }, [loadRaceSnapshotCounts]);

  const loadHistory = useCallback(
    (opts?: {
      silent?: boolean;
      meeting_date?: string;
      venue_code?: string;
      race_no?: number;
    }) => {
      const md = opts?.meeting_date ?? meetingDate;
      const vc = opts?.venue_code ?? venueCode;
      const rn = opts?.race_no ?? raceNo;
      if (!md || !vc || !rn) return Promise.resolve();
      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      setHistErr(null);
      const qs = new URLSearchParams({
        meeting_date: md,
        venue_code: vc,
        race_no: String(rn),
        limit: "300",
      });
      return apiFetch<HistoryResponse>(`/api/realtime/history?${qs}`)
        .then((r) => setHistory(r.snapshots ?? []))
        .catch((e: Error) => {
          setHistErr(e.message);
          setHistory([]);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [meetingDate, venueCode, raceNo]
  );

  useEffect(() => {
    loadHistory({ silent: false });
  }, [loadHistory]);

  useEffect(() => {
    const id = window.setInterval(() => loadHistory({ silent: true }), refreshMs);
    return () => window.clearInterval(id);
  }, [loadHistory, refreshMs]);

  useEffect(() => {
    localStorage.setItem(LS_REFRESH_KEY, String(refreshMs));
  }, [refreshMs]);

  useEffect(() => {
    const races = meeting?.races ?? [];
    if (races.length === 0) return;
    const nums = races
      .map((r) => parseInt(String(r.no), 10))
      .filter((n) => Number.isFinite(n));
    if (nums.length && !nums.includes(raceNo)) {
      setRaceNo(Math.min(...nums));
    }
  }, [meeting, raceNo]);

  const isPairPool = chartPool === "QIN" || chartPool === "QPL";

  useEffect(() => {
    setPairSelected(new Set());
  }, [chartPool, meetingDate, venueCode, raceNo]);

  const togglePairKey = useCallback((key: string) => {
    setPairSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pairPoolNodes = useMemo(() => {
    if (!isPairPool || history.length === 0) {
      return { latest: undefined as OddsNode[] | undefined, prev: undefined as OddsNode[] | undefined };
    }
    const last = history[history.length - 1];
    const prevSnap = history.length > 1 ? history[history.length - 2] : null;
    const poolsL = normalizePoolsPayload(last.payload);
    const poolL = poolsL.find((p) => poolMatches(p, chartPool));
    const poolsP = prevSnap ? normalizePoolsPayload(prevSnap.payload) : [];
    const poolP = poolsP.find((p) => poolMatches(p, chartPool));
    return { latest: poolL?.oddsNodes, prev: poolP?.oddsNodes };
  }, [history, chartPool, isPairPool]);

  const pairFieldSize = useMemo(
    () => inferPairFieldSize(meeting, raceNo, pairPoolNodes.latest),
    [meeting, raceNo, pairPoolNodes.latest]
  );

  const pairCellData = useMemo(
    () => buildPairCellMap(pairPoolNodes.latest, pairPoolNodes.prev, parseOddsValue),
    [pairPoolNodes.latest, pairPoolNodes.prev]
  );

  const pairChartSeries = useMemo(
    () => buildChartSeriesForSelectedPairCombs(history, chartPool, pairSelected, MAX_PAIR_TIMELINE_SERIES),
    [history, chartPool, pairSelected]
  );

  const pairChartOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "#94a3b8" },
      tooltip: { trigger: "axis" as const },
      legend: {
        type: "scroll" as const,
        top: 0,
        textStyle: { color: "#94a3b8", fontSize: 11 },
      },
      grid: { left: 48, right: 16, top: 44, bottom: 24 },
      xAxis: {
        type: "time" as const,
        axisLine: { lineStyle: { color: "#475569" } },
      },
      yAxis: {
        type: "value" as const,
        scale: true,
        splitLine: { lineStyle: { color: "#334155" } },
        axisLine: { lineStyle: { color: "#475569" } },
      },
      series: pairChartSeries,
    };
  }, [pairChartSeries]);

  const chartSeries = useMemo(
    () => buildChartSeries(history, chartPool, MAX_CHART_SERIES),
    [history, chartPool]
  );

  const tableRows = useMemo(() => latestNodesByComb(history, tablePool), [history, tablePool]);

  const chartOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "#94a3b8" },
      tooltip: { trigger: "axis" as const },
      legend: {
        type: "scroll" as const,
        top: 0,
        textStyle: { color: "#94a3b8", fontSize: 11 },
      },
      grid: { left: 48, right: 16, top: 44, bottom: 24 },
      xAxis: {
        type: "time" as const,
        axisLine: { lineStyle: { color: "#475569" } },
      },
      yAxis: {
        type: "value" as const,
        scale: true,
        splitLine: { lineStyle: { color: "#334155" } },
        axisLine: { lineStyle: { color: "#475569" } },
      },
      series: chartSeries,
    };
  }, [chartSeries]);

  const applyServerInterval = () => {
    setSettingsMsg(null);
    apiFetch<{ workerIntervalMs: number }>("/api/realtime/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerIntervalMs: refreshMs }),
    })
      .then((r) => {
        setSettingsMsg(`Server worker interval set to ${r.workerIntervalMs} ms`);
        loadSettings();
        loadStatus();
      })
      .catch((e: Error) => setSettingsMsg(e.message));
  };

  const runServerSync = () => {
    setSyncLoading(true);
    setSettingsMsg(null);
    apiFetch<{ inserted: number; racesChecked: number; meetings: number }>("/api/realtime/sync", { method: "POST" })
      .then((r) => {
        setSettingsMsg(`Full sync done: inserted ${r.inserted}, racesChecked ${r.racesChecked}`);
        return loadMeetings();
      })
      .then((freshMeetings) => {
        const idx = freshMeetings.length ? Math.min(meetingIdx, freshMeetings.length - 1) : 0;
        const m = freshMeetings[idx];
        const md = m?.date ? String(m.date).slice(0, 10) : "";
        const vc = m?.venueCode ? String(m.venueCode) : "";
        const key = md && vc ? { meeting_date: md, venue_code: vc } : undefined;
        return Promise.all([
          key
            ? loadHistory({ silent: false, meeting_date: md, venue_code: vc, race_no: raceNo })
            : loadHistory({ silent: false }),
          key ? loadRaceSnapshotCounts(key) : loadRaceSnapshotCounts(),
        ]);
      })
      .then(() => loadStatus())
      .catch((e: Error) => setSettingsMsg(e.message))
      .finally(() => setSyncLoading(false));
  };

  const startIntervalForSelectedRace = () => {
    if (!meetingDate || !venueCode || intervalSyncRaceNos.length === 0) return;
    setIntervalSyncLoading(true);
    setSettingsMsg(null);
    const races = intervalSyncRaceNos.map((race_no) => ({
      meeting_date: meetingDate,
      venue_code: venueCode,
      race_no,
    }));
    apiFetch<{ ok: boolean; targets?: SyncRaceKey[] }>("/api/realtime/sync-interval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ races }),
    })
      .then((r) => {
        const n = r.targets?.length ?? races.length;
        setSettingsMsg(`Interval sync armed for ${n} race(s) at ${venueCode}: ${intervalSyncRaceNos.join(", ")}`);
        return loadStatus();
      })
      .catch((e: Error) => setSettingsMsg(e.message))
      .finally(() => setIntervalSyncLoading(false));
  };

  const stopIntervalSync = () => {
    setIntervalSyncLoading(true);
    setSettingsMsg(null);
    apiFetch<{ ok: boolean }>("/api/realtime/sync-interval", { method: "DELETE" })
      .then(() => {
        setSettingsMsg("Interval sync stopped");
        return loadStatus();
      })
      .catch((e: Error) => setSettingsMsg(e.message))
      .finally(() => setIntervalSyncLoading(false));
  };

  const raceNumbers = useMemo(() => {
    const races = meeting?.races ?? [];
    const nums = races
      .map((r) => parseInt(String(r.no), 10))
      .filter((n) => Number.isFinite(n));
    return [...new Set(nums)].sort((a, b) => a - b);
  }, [meeting]);

  const intervalMeetingKey = useMemo(() => {
    const m = meetings[meetingIdx];
    if (!m?.date || m.venueCode == null) return "";
    return `${String(m.date).slice(0, 10)}-${String(m.venueCode)}`;
  }, [meetings, meetingIdx]);

  const raceNosKey = raceNumbers.join(",");

  useEffect(() => {
    if (!raceNumbers.length) {
      setIntervalSyncRaceNos([]);
      return;
    }
    setIntervalSyncRaceNos([raceNumbers[0]]);
  }, [intervalMeetingKey, raceNosKey]);

  const toggleIntervalRaceNo = useCallback((n: number) => {
    setIntervalSyncRaceNos((prev) => {
      const set = new Set(prev);
      if (set.has(n)) set.delete(n);
      else set.add(n);
      return [...set].sort((a, b) => a - b);
    });
  }, []);

  const armedList = status ? armedIntervalList(status) : [];

  return (
    <div className="realtime-page">
      <h2 className="card-title" style={{ marginTop: 0 }}>
        Realtime odds
      </h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Snapshots from HKJC GraphQL (worker poll + hash dedup). If pool odds are empty, we use runner win odds from the
        racecard. Use <strong>Auto-sync races</strong> to choose one or more races for server polling, then{" "}
        <strong>Start interval (selected races)</strong>; or <strong>Sync all races (once)</strong> for a full sweep. For
        QIN/QPL matrix + timeline, set <code>ODDS_SYNC_ODDS_TYPES</code> to include <code>QIN</code> and <code>QPL</code>{" "}
        (see <code>.env.example</code>).
      </p>
      {status && (
        <>
          <p className="muted realtime-worker-line" style={{ marginBottom: 12, fontSize: 13 }}>
            Server sync: {status.oddsSyncEnabled ? "on" : "off"} · worker {status.workerIntervalMs} ms
            {status.legacyFullInterval && (
              <span style={{ color: "#fbbf24" }}> · legacy: full sweep each tick</span>
            )}
            {status.lastSync?.at && (
              <>
                {" "}
                · last {new Date(status.lastSync.at).toLocaleString()}
                {status.lastSync.result && (
                  <>
                    {" "}
                    (inserted {status.lastSync.result.inserted ?? 0}, checked {status.lastSync.result.racesChecked ?? 0} races)
                  </>
                )}
                {status.lastSync.error && <span style={{ color: "#f87171" }}> · {status.lastSync.error}</span>}
              </>
            )}
            {status.currentSync?.kind === "full" && (
              <span style={{ color: "#a5b4fc" }}>
                {" "}
                · full sweep: {status.currentSync.venue_code} R{status.currentSync.race_no}…
              </span>
            )}
          </p>

          <div className="card realtime-auto-sync" style={{ marginBottom: 16 }}>
            <div className="realtime-auto-sync-inner">
              <div className="realtime-auto-sync-main">
                <span className="realtime-auto-sync-title">Auto-sync</span>
                {status.legacyFullInterval ? (
                  <p className="muted realtime-auto-sync-desc" style={{ margin: 0 }}>
                    Worker runs a <strong>full meeting sweep</strong> on each tick. Per-race stop is not available. Set{" "}
                    <code>ODDS_SYNC_LEGACY_FULL_INTERVAL=false</code> for single-race interval sync.
                  </p>
                ) : !status.oddsSyncEnabled ? (
                  <p className="muted realtime-auto-sync-desc" style={{ margin: 0 }}>
                    HKJC polling is off (<code>ODDS_SYNC_ENABLED=false</code>).
                  </p>
                ) : armedList.length ? (
                  <div className="realtime-auto-sync-armed">
                    <p className="realtime-auto-sync-race" style={{ margin: 0 }}>
                      {armedList[0].meeting_date} · {armedList[0].venue_code} · Races{" "}
                      {armedList.map((t) => t.race_no).join(", ")}
                      {isFetchingArmedIntervalRace(status) && (
                        <span className="realtime-auto-sync-live" aria-live="polite">
                          <span className="realtime-auto-sync-dot" />
                          Fetching…
                        </span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="muted realtime-auto-sync-desc" style={{ margin: 0 }}>
                    No race armed for automatic sync. Tick one or more races under Auto-sync races, then &quot;Start
                    interval (selected races)&quot;.
                  </p>
                )}
              </div>
              {!status.legacyFullInterval && status.oddsSyncEnabled && (
                <button
                  type="button"
                  className="btn-secondary realtime-auto-sync-stop"
                  onClick={() => stopIntervalSync()}
                  disabled={intervalSyncLoading || armedList.length === 0}
                  title="Stop automatic polling for all armed races"
                >
                  {intervalSyncLoading ? "…" : "Stop auto-sync"}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="controls realtime-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div>
            <label className="field-label">Meeting</label>
            <select
              value={meetingIdx}
              onChange={(e) => setMeetingIdx(Number(e.target.value))}
              disabled={!meetings.length}
            >
              {meetings.map((m, i) => (
                <option key={`${m.date}-${m.venueCode}-${i}`} value={i}>
                  {String(m.date).slice(0, 10)} · {m.venueCode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Race</label>
            <select value={raceNo} onChange={(e) => setRaceNo(Number(e.target.value))} disabled={!raceNumbers.length}>
              {raceNumbers.map((n) => {
                const cnt = raceSnapshotCounts[n] ?? 0;
                return (
                  <option key={n} value={n}>
                    Race {n}
                    {cnt > 0 ? ` (${cnt} snapshots)` : ""}
                  </option>
                );
              })}
            </select>
          </div>
          {!status?.legacyFullInterval && status?.oddsSyncEnabled !== false && raceNumbers.length > 0 && (
            <div className="realtime-interval-races">
              <span className="field-label">Auto-sync races</span>
              <div className="realtime-interval-races-checks" role="group" aria-label="Races to include in server auto-sync">
                {raceNumbers.map((n) => (
                  <label key={n} className="realtime-interval-race-check">
                    <input
                      type="checkbox"
                      checked={intervalSyncRaceNos.includes(n)}
                      onChange={() => toggleIntervalRaceNo(n)}
                    />
                    <span>Race {n}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="field-label">Chart pool</label>
            <select value={chartPool} onChange={(e) => setChartPool(e.target.value as PoolOption)}>
              {POOL_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Table pool</label>
            <select value={tablePool} onChange={(e) => setTablePool(e.target.value as PoolOption)}>
              {POOL_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Page refresh</label>
            <select value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}>
              {REFRESH_CHOICES_MS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000}s
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-secondary" onClick={() => loadHistory()} disabled={loading}>
            Refresh now
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => runServerSync()}
            disabled={syncLoading || status?.oddsSyncEnabled === false}
            title="Fetch odds for every active meeting and race once (full sweep)"
          >
            {syncLoading ? "Syncing…" : "Sync all races (once)"}
          </button>
          {!status?.legacyFullInterval && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => startIntervalForSelectedRace()}
                disabled={
                  intervalSyncLoading ||
                  status?.oddsSyncEnabled === false ||
                  !meetingDate ||
                  !venueCode ||
                  intervalSyncRaceNos.length === 0
                }
                title="Poll HKJC on the server interval for each selected race, every worker tick"
              >
                {intervalSyncLoading ? "…" : "Start interval (selected races)"}
              </button>
            </>
          )}
        </div>

        {settings?.oddsSyncEnabled !== false && (
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn-secondary" onClick={applyServerInterval}>
              Apply page refresh interval to server worker
            </button>
            {settings && (
              <span className="muted" style={{ fontSize: 13 }}>
                Server worker: {settings.workerIntervalMs} ms
              </span>
            )}
            {settingsMsg && <span style={{ fontSize: 13, color: "#fbbf24" }}>{settingsMsg}</span>}
          </div>
        )}

        {meetingsErr && <p className="error-text">{meetingsErr}</p>}
        {histErr && <p className="error-text">{histErr}</p>}
        {loading && <p className="muted">Loading…</p>}
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Snapshots for <strong>{meetingDate || "—"}</strong> · <strong>{venueCode || "—"}</strong> · race{" "}
          <strong>{raceNo}</strong>: <strong>{history.length}</strong>
        </p>
      </div>

      {isPairPool ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <PairOddsMatrix
              poolType={chartPool as PairPoolType}
              fieldSize={pairFieldSize}
              cellData={pairCellData}
              selected={pairSelected}
              onToggle={togglePairKey}
              onClearSelection={() => setPairSelected(new Set())}
            />
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card-title">Selected combinations over time ({chartPool})</h3>
            {pairSelected.size === 0 ? (
              <p className="muted">Select one or more cells in the matrix above to plot odds over time.</p>
            ) : pairChartSeries.length === 0 ? (
              <p className="muted">No history points yet for the selected combinations.</p>
            ) : (
              <ReactECharts option={pairChartOption} style={{ height: 380 }} opts={{ renderer: "canvas" }} />
            )}
          </div>
          <div className="card">
            <h3 className="card-title">Latest {tablePool} (vs previous snapshot)</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Combination</th>
                    <th>Odds</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => {
                    const delta =
                      row.prev != null && Number.isFinite(row.prev) ? Math.round((row.odds - row.prev) * 100) / 100 : null;
                    return (
                      <tr key={row.comb}>
                        <td>{row.comb}</td>
                        <td>{row.odds}</td>
                        <td
                          style={{
                            color: delta == null ? "#64748b" : delta > 0 ? "#f87171" : delta < 0 ? "#4ade80" : "#94a3b8",
                          }}
                        >
                          {delta == null ? "—" : delta > 0 ? `+${delta}` : String(delta)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {tableRows.length === 0 && <p className="muted">No rows for this pool in the latest snapshot.</p>}
            </div>
          </div>
        </>
      ) : (
        <div className="grid-2">
          <div className="card">
            <h3 className="card-title">Odds over time ({chartPool})</h3>
            {chartSeries.length === 0 ? (
              <p className="muted">
                {history.length === 0
                  ? "No snapshots stored for this meeting + race. Pick another race (sync may have only updated a few races), or run Sync from HKJC again."
                  : `Snapshots loaded (${history.length}) but no ${chartPool} odds nodes — try another pool or confirm HKJC has published ${chartPool} for this race.`}
              </p>
            ) : (
              <ReactECharts option={chartOption} style={{ height: 420 }} opts={{ renderer: "canvas" }} />
            )}
          </div>
          <div className="card">
            <h3 className="card-title">Latest {tablePool} (vs previous snapshot)</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Combination</th>
                    <th>Odds</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => {
                    const delta =
                      row.prev != null && Number.isFinite(row.prev) ? Math.round((row.odds - row.prev) * 100) / 100 : null;
                    return (
                      <tr key={row.comb}>
                        <td>{row.comb}</td>
                        <td>{row.odds}</td>
                        <td
                          style={{
                            color: delta == null ? "#64748b" : delta > 0 ? "#f87171" : delta < 0 ? "#4ade80" : "#94a3b8",
                          }}
                        >
                          {delta == null ? "—" : delta > 0 ? `+${delta}` : String(delta)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {tableRows.length === 0 && <p className="muted">No rows for this pool in the latest snapshot.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
