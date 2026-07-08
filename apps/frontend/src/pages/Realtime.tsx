import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import { echartsRealtimeLineChartBase, type ThemeTokens } from "../themeTokens";
import { useTheme } from "../theme/ThemeContext.tsx";
import PairOddsMatrix, { buildPairCellMap, type PairPoolType } from "../components/PairOddsMatrix.tsx";
import PageHeader from "../components/PageHeader.tsx";
import RaceTimeContext from "../components/RaceTimeContext.tsx";
import { normalizePairKeyFromComb } from "../lib/pairComb.ts";
import {
  readRealtimeSessionPrefs,
  readSharedMeetingRace,
  resolveMeetingIndex,
  resolveRaceNo,
  writeRealtimeSessionPrefs,
  writeSharedMeetingRace,
} from "../lib/pageSessionPrefs.ts";
import { apiFetch } from "../api/client.ts";
import OddsSyncChips from "../components/OddsSyncChips.tsx";

const LS_REFRESH_KEY = "hkjc_realtime_refresh_ms";
const REFRESH_CHOICES_MS = [5000, 10000, 15000, 30000, 60000] as const;
const DEFAULT_REFRESH_MS = 10000;
const LS_TIMELINE_HOURS_KEY = "hkjc_realtime_timeline_hours";
const TIMELINE_HOURS_CHOICES = [1, 3, 6, 12, 24, 48] as const;
const DEFAULT_TIMELINE_HOURS = 12;
/** Must match server max limit when `since` is set. */
const HISTORY_LIMIT_WITH_SINCE = 5000;
const MAX_CHART_SERIES = 18;
const MAX_PAIR_TIMELINE_SERIES = 12;
/** Must match Compare page cap when sending a full field to Horse Comparison. */
const MAX_COMPARE_HORSES = 14;

function oddsDeltaColor(delta: number | null, theme: ThemeTokens): string {
  if (delta == null) return theme.textFaint;
  if (delta > 0) return theme.danger;
  if (delta < 0) return theme.success;
  return theme.textMuted;
}

function RealtimeLatestOddsCard(props: {
  tablePool: string;
  rows: { comb: string; odds: number; prev: number | null }[];
  theme: ThemeTokens;
}) {
  const { tablePool, rows, theme } = props;
  return (
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
            {rows.map((row) => {
              const delta = row.prev != null && Number.isFinite(row.prev) ? Math.round((row.odds - row.prev) * 100) / 100 : null;
              return (
                <tr key={row.comb}>
                  <td>{row.comb}</td>
                  <td>{row.odds}</td>
                  <td style={{ color: oddsDeltaColor(delta, theme) }}>{delta == null ? "—" : delta > 0 ? `+${delta}` : String(delta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted">No rows for this pool in the latest snapshot.</p>}
      </div>
    </div>
  );
}

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

interface RacecardRunner {
  no: number | null;
  horse_name: string;
  horse_code: string;
  status?: string;
  is_standby?: boolean;
  standby_no?: number | null;
}

interface RaceRunnersResponse {
  runners: RacecardRunner[];
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

function readTimelineHours(): number {
  try {
    const v = localStorage.getItem(LS_TIMELINE_HOURS_KEY);
    if (!v) return DEFAULT_TIMELINE_HOURS;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return DEFAULT_TIMELINE_HOURS;
    const allowed = TIMELINE_HOURS_CHOICES as readonly number[];
    return allowed.includes(n) ? n : DEFAULT_TIMELINE_HOURS;
  } catch {
    return DEFAULT_TIMELINE_HOURS;
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

/** Best-effort: per-race fetch; merge runners in race order and dedupe horse_code. */
async function fetchRunnersForMeetingRaces(
  meetingDate: string,
  venueCode: string,
  raceNumbers: number[]
): Promise<{ codes: string[]; raceErrors: { race_no: number; message: string }[] }> {
  const results = await Promise.all(
    raceNumbers.map(async (race_no) => {
      const qs = new URLSearchParams({
        meeting_date: meetingDate,
        venue_code: venueCode,
        race_no: String(race_no),
      });
      try {
        const r = await apiFetch<RaceRunnersResponse>(`/api/realtime/race-runners?${qs}`);
        return { race_no, runners: r.runners ?? [], error: null as string | null };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { race_no, runners: [] as RacecardRunner[], error: message };
      }
    })
  );
  const raceErrors = results
    .filter((x) => x.error)
    .map((x) => ({ race_no: x.race_no, message: x.error! }));
  const sorted = [...results].sort((a, b) => a.race_no - b.race_no);
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const { runners } of sorted) {
    for (const r of runners) {
      const c = String(r.horse_code ?? "").trim().toUpperCase();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      codes.push(c);
    }
  }
  return { codes, raceErrors };
}

interface ScraperStatusResponse {
  "horse-details": { running: { pid: number } | null };
}

function formatHorseCodeDisplay(code: string | undefined): string {
  const s = String(code ?? "").trim();
  return s ? s.toUpperCase() : "—";
}

function isRacecardBackup(r: RacecardRunner): boolean {
  return Boolean(r.is_standby) || r.no == null || r.no <= 0;
}

/** Declared runners show betting horse no; standby (後備) never show as 0. */
function formatRacecardHorseNo(r: RacecardRunner): string {
  if (isRacecardBackup(r)) return "Back Up";
  return String(r.no);
}

/** Declared by horse no first; Back Up (後備) always at the bottom. */
function sortRacecardRunners(runners: RacecardRunner[]): RacecardRunner[] {
  return [...runners].sort((a, b) => {
    const aBackup = isRacecardBackup(a);
    const bBackup = isRacecardBackup(b);
    if (aBackup !== bBackup) return aBackup ? 1 : -1;
    if (aBackup) return (a.standby_no ?? 99) - (b.standby_no ?? 99);
    return (a.no ?? 0) - (b.no ?? 0);
  });
}

function readInitialRealtimePrefs() {
  const saved = readRealtimeSessionPrefs();
  const chartPool = POOL_OPTIONS.includes(saved?.chartPool as PoolOption)
    ? (saved!.chartPool as PoolOption)
    : "WIN";
  const tablePool = POOL_OPTIONS.includes(saved?.tablePool as PoolOption)
    ? (saved!.tablePool as PoolOption)
    : chartPool;
  const timelineHours =
    typeof saved?.timelineHours === "number" &&
    (TIMELINE_HOURS_CHOICES as readonly number[]).includes(saved.timelineHours)
      ? saved.timelineHours
      : readTimelineHours();
  const refreshMs =
    typeof saved?.refreshMs === "number" && (REFRESH_CHOICES_MS as readonly number[]).includes(saved.refreshMs)
      ? saved.refreshMs
      : readRefreshMs();
  return {
    chartPool,
    tablePool,
    lockPools: saved?.lockPools !== false,
    timelineHours,
    refreshMs,
  };
}

export default function Realtime() {
  const { tokens: theme } = useTheme();
  const navigate = useNavigate();
  const initialRtPrefs = useMemo(() => readInitialRealtimePrefs(), []);
  const initialMeetingRace = useMemo(() => readSharedMeetingRace(), []);
  const [meetings, setMeetings] = useState<ActiveMeeting[]>([]);
  const [meetingsErr, setMeetingsErr] = useState<string | null>(null);
  const [meetingIdx, setMeetingIdx] = useState(0);
  const [raceNo, setRaceNo] = useState(initialMeetingRace?.raceNo ?? 1);
  const [chartPool, setChartPool] = useState<PoolOption>(initialRtPrefs.chartPool);
  const [tablePool, setTablePool] = useState<PoolOption>(initialRtPrefs.tablePool);
  const [lockPools, setLockPools] = useState(initialRtPrefs.lockPools);
  const [refreshMs, setRefreshMs] = useState(initialRtPrefs.refreshMs);
  const [timelineHours, setTimelineHours] = useState(initialRtPrefs.timelineHours);
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
  const [raceRunners, setRaceRunners] = useState<RacecardRunner[]>([]);
  const [raceRunnersLoading, setRaceRunnersLoading] = useState(false);
  const [raceRunnersErr, setRaceRunnersErr] = useState<string | null>(null);
  const [bulkHorseDetailsLoading, setBulkHorseDetailsLoading] = useState(false);
  const [bulkHorseDetailsMsg, setBulkHorseDetailsMsg] = useState<string | null>(null);
  const [bulkHorseDetailsErr, setBulkHorseDetailsErr] = useState<string | null>(null);
  const [watchHorseDetailsScraper, setWatchHorseDetailsScraper] = useState(false);
  const horseDetailsSawRunningRef = useRef(false);
  const [openSectionView, setOpenSectionView] = useState(true);
  const [openSectionSync, setOpenSectionSync] = useState(true);
  const [openSectionTools, setOpenSectionTools] = useState(true);

  const meeting = meetings[meetingIdx] ?? null;
  const meetingDate = meeting?.date ? String(meeting.date).slice(0, 10) : "";
  const venueCode = meeting?.venueCode ? String(meeting.venueCode) : "";

  const loadMeetings = useCallback((): Promise<ActiveMeeting[]> => {
    setMeetingsErr(null);
    return apiFetch<MeetingsResponse>("/api/realtime/meetings")
      .then((r) => {
        const list = r.meetings ?? [];
        setMeetings(list);
        const saved = readSharedMeetingRace();
        if (list.length) {
          setMeetingIdx(resolveMeetingIndex(list, saved));
          if (saved?.raceNo) {
            const m = list[resolveMeetingIndex(list, saved)];
            const nums = (m?.races ?? [])
              .map((race) => parseInt(String(race.no), 10))
              .filter((n) => Number.isFinite(n));
            setRaceNo(resolveRaceNo([...new Set(nums)].sort((a, b) => a - b), saved.raceNo));
          }
        }
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

  useEffect(() => {
    if (!meetingDate || !venueCode || !raceNo) {
      setRaceRunners([]);
      setRaceRunnersErr(null);
      return;
    }
    setRaceRunnersLoading(true);
    setRaceRunnersErr(null);
    const qs = new URLSearchParams({
      meeting_date: meetingDate,
      venue_code: venueCode,
      race_no: String(raceNo),
    });
    apiFetch<RaceRunnersResponse>(`/api/realtime/race-runners?${qs}`)
      .then((r) => {
        setRaceRunners(sortRacecardRunners(r.runners ?? []));
      })
      .catch((e: Error) => {
        setRaceRunners([]);
        setRaceRunnersErr(e.message);
      })
      .finally(() => setRaceRunnersLoading(false));
  }, [meetingDate, venueCode, raceNo]);

  const openCompareWithField = useCallback(() => {
    const seen = new Set<string>();
    const horses: { code: string; name: string }[] = [];
    for (const row of raceRunners) {
      if (horses.length >= MAX_COMPARE_HORSES) break;
      if (seen.has(row.horse_code)) continue;
      seen.add(row.horse_code);
      horses.push({ code: row.horse_code, name: row.horse_name });
    }
    navigate("/compare", { state: { comparePreset: { horses } } });
  }, [navigate, raceRunners]);

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
      const since = new Date(Date.now() - timelineHours * 60 * 60 * 1000).toISOString();
      const qs = new URLSearchParams({
        meeting_date: md,
        venue_code: vc,
        race_no: String(rn),
        since,
        limit: String(HISTORY_LIMIT_WITH_SINCE),
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
    [meetingDate, venueCode, raceNo, timelineHours]
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
    localStorage.setItem(LS_TIMELINE_HOURS_KEY, String(timelineHours));
  }, [timelineHours]);

  useEffect(() => {
    if (!meetingDate || !venueCode || !raceNo) return;
    writeSharedMeetingRace({ meetingDate, venueCode, raceNo });
  }, [meetingDate, venueCode, raceNo]);

  useEffect(() => {
    writeRealtimeSessionPrefs({
      chartPool,
      tablePool,
      lockPools,
      timelineHours,
      refreshMs,
    });
  }, [chartPool, tablePool, lockPools, timelineHours, refreshMs]);

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
      ...echartsRealtimeLineChartBase(theme),
      series: pairChartSeries,
    };
  }, [pairChartSeries, theme]);

  const chartSeries = useMemo(
    () => buildChartSeries(history, chartPool, MAX_CHART_SERIES),
    [history, chartPool]
  );

  const tableRows = useMemo(() => latestNodesByComb(history, tablePool), [history, tablePool]);

  const chartOption = useMemo(() => {
    return {
      ...echartsRealtimeLineChartBase(theme),
      series: chartSeries,
    };
  }, [chartSeries, theme]);

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

  const selectedRace = useMemo(() => {
    if (!meeting) return null;
    return (meeting.races ?? []).find((r) => parseInt(String(r.no), 10) === raceNo) ?? null;
  }, [meeting, raceNo]);

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

  const runBulkHorseDetails = useCallback(async () => {
    setBulkHorseDetailsErr(null);
    setBulkHorseDetailsMsg(null);
    if (!meetingDate || !venueCode || raceNumbers.length === 0) {
      setBulkHorseDetailsErr("Select a meeting with races first.");
      return;
    }
    setBulkHorseDetailsLoading(true);
    try {
      const { codes, raceErrors } = await fetchRunnersForMeetingRaces(meetingDate, venueCode, raceNumbers);
      if (codes.length === 0) {
        if (raceErrors.length) {
          const sample = raceErrors.slice(0, 3).map((e) => `R${e.race_no}`).join(", ");
          setBulkHorseDetailsErr(
            `No horse codes collected (${raceErrors.length} race(s) failed${sample ? `: ${sample}` : ""}).`
          );
        } else {
          setBulkHorseDetailsErr("No horse codes found (racecards may not be published yet).");
        }
        return;
      }
      await apiFetch<{ ok: boolean; message?: string }>("/api/scraper/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: "horse-details",
          horseCodes: codes,
          horseDetailsSkipScraped: false,
        }),
      });
      horseDetailsSawRunningRef.current = false;
      const partial =
        raceErrors.length > 0
          ? `${raceErrors.length} race(s) had no racecard (skipped). `
          : "";
      setBulkHorseDetailsMsg(
        `${partial}Started horse-details for ${codes.length} distinct horse code(s) (skip-scraped off — re-scrapes all listed codes).`
      );
      setWatchHorseDetailsScraper(true);
    } catch (e) {
      setBulkHorseDetailsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkHorseDetailsLoading(false);
    }
  }, [meetingDate, venueCode, raceNumbers]);

  useEffect(() => {
    if (!watchHorseDetailsScraper) {
      horseDetailsSawRunningRef.current = false;
      return;
    }
    const poll = () => {
      apiFetch<ScraperStatusResponse>("/api/scraper/status")
        .then((s) => {
          const running = s["horse-details"]?.running;
          if (running) horseDetailsSawRunningRef.current = true;
          if (horseDetailsSawRunningRef.current && !running) {
            setWatchHorseDetailsScraper(false);
            horseDetailsSawRunningRef.current = false;
            setBulkHorseDetailsMsg((prev) => (prev ? `${prev} Job finished.` : "Horse-details job finished."));
          }
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [watchHorseDetailsScraper]);

  const armedList = status ? armedIntervalList(status) : [];
  const latestSnapshotAt = history.length ? history[history.length - 1].observed_at : null;

  const onChangeChartPool = (next: PoolOption) => {
    setChartPool(next);
    if (lockPools) {
      setTablePool(next);
    }
  };

  return (
    <div className="realtime-page">
      <PageHeader title="Realtime odds" subtitle="追蹤即時賠率、快照同步與賽事欄位資料。" />
      <div className="card realtime-context-card" style={{ marginBottom: 16 }}>
        <div className="realtime-context-main">
          <p className="realtime-context-line">
            {meetingDate || "—"} · {venueCode || "—"} · Race {raceNo}
          </p>
          {meetingDate ? <RaceTimeContext meetingDate={meetingDate} race={selectedRace} /> : null}
          <p className="muted realtime-context-meta" style={{ margin: 0 }}>
            快照數：<strong>{history.length}</strong>
            {latestSnapshotAt ? <> · 最新：{new Date(latestSnapshotAt).toLocaleString()}</> : null}
            {loading ? <> · 更新中…</> : null}
          </p>
          {status && meetingDate && venueCode ? (
            <OddsSyncChips
              status={status}
              race={{ meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo }}
            />
          ) : null}
        </div>
      </div>
      {status && (
        <>
          <p className="muted realtime-worker-line" style={{ marginBottom: 12, fontSize: 13 }}>
            伺服器同步：{status.oddsSyncEnabled ? "啟用" : "停用"} · 週期 {status.workerIntervalMs} ms
            {status.legacyFullInterval && (
              <span className="text-accent"> · 全場掃描模式</span>
            )}
            {status.lastSync?.error && <span className="text-danger"> · {status.lastSync.error}</span>}
            {status.currentSync?.kind === "full" && (
              <span className="text-info">
                {" "}
                · 全場同步中：{status.currentSync.venue_code} R{status.currentSync.race_no}…
              </span>
            )}
          </p>

          <div className="card realtime-auto-sync" style={{ marginBottom: 16 }}>
            <div className="realtime-auto-sync-inner">
              <div className="realtime-auto-sync-main">
                <span className="realtime-auto-sync-title">Auto-sync</span>
                {status.legacyFullInterval ? (
                  <p className="muted realtime-auto-sync-desc" style={{ margin: 0 }}>
                    目前採用「每次更新掃描整場」模式，無法按單場停止。
                  </p>
                ) : !status.oddsSyncEnabled ? (
                  <p className="muted realtime-auto-sync-desc" style={{ margin: 0 }}>
                    即時同步目前停用。
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
                    尚未設定自動同步場次。請在下方勾選場次後啟動。
                  </p>
                )}
              </div>
              {!status.legacyFullInterval && status.oddsSyncEnabled && (
                <button
                  type="button"
                  className="btn-secondary realtime-auto-sync-stop"
                  onClick={() => stopIntervalSync()}
                  disabled={intervalSyncLoading || armedList.length === 0}
                  title="停止全部自動同步"
                >
                  {intervalSyncLoading ? "…" : "停止自動同步"}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="realtime-controls-stack">
          <section className="realtime-section" aria-labelledby="realtime-heading-view">
            <h3 id="realtime-heading-view" className="realtime-section-title">
              <button
                type="button"
                className="realtime-section-toggle"
                aria-expanded={openSectionView}
                aria-controls="realtime-panel-view"
                onClick={() => setOpenSectionView((v) => !v)}
              >
                <span className="realtime-section-toggle-text">資料檢視</span>
                <span className="realtime-section-chevron" aria-hidden>
                  {openSectionView ? "▼" : "▶"}
                </span>
              </button>
            </h3>
            <div id="realtime-panel-view" className="realtime-section-panel" hidden={!openSectionView}>
              <p className="realtime-section-hint muted">
                選擇賽馬日、場次與彩池。時間範圍與頁面刷新頻率會影響下方圖表與表格。
              </p>
              <div className="realtime-section-body realtime-section-view-controls controls">
                <div>
                  <label className="field-label">賽馬日</label>
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
                  <label className="field-label">場次</label>
                  <select value={raceNo} onChange={(e) => setRaceNo(Number(e.target.value))} disabled={!raceNumbers.length}>
                    {raceNumbers.map((n) => {
                      const cnt = raceSnapshotCounts[n] ?? 0;
                      return (
                        <option key={n} value={n}>
                          第 {n} 場
                          {cnt > 0 ? ` (${cnt} snapshots)` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="field-label">圖表彩池</label>
                  <select value={chartPool} onChange={(e) => onChangeChartPool(e.target.value as PoolOption)}>
                    {POOL_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">表格彩池</label>
                  <select value={tablePool} onChange={(e) => setTablePool(e.target.value as PoolOption)}>
                    {POOL_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="realtime-pool-lock">
                  <input type="checkbox" checked={lockPools} onChange={(e) => setLockPools(e.target.checked)} />
                  <span>圖表與表格使用同一彩池</span>
                </label>
                <div>
                  <label className="field-label">時間範圍</label>
                  <select value={timelineHours} onChange={(e) => setTimelineHours(Number(e.target.value))}>
                    {TIMELINE_HOURS_CHOICES.map((h) => (
                      <option key={h} value={h}>
                        Last {h}h
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">頁面刷新</label>
                  <select value={refreshMs} onChange={(e) => setRefreshMs(Number(e.target.value))}>
                    {REFRESH_CHOICES_MS.map((ms) => (
                      <option key={ms} value={ms}>
                        {ms / 1000}s
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => loadHistory()} disabled={loading}>
                  立即更新
                </button>
              </div>
            </div>
          </section>

          <section className="realtime-section" aria-labelledby="realtime-heading-sync">
            <h3 id="realtime-heading-sync" className="realtime-section-title">
              <button
                type="button"
                className="realtime-section-toggle"
                aria-expanded={openSectionSync}
                aria-controls="realtime-panel-sync"
                onClick={() => setOpenSectionSync((v) => !v)}
              >
                <span className="realtime-section-toggle-text">伺服器同步</span>
                <span className="realtime-section-chevron" aria-hidden>
                  {openSectionSync ? "▼" : "▶"}
                </span>
              </button>
            </h3>
            <div id="realtime-panel-sync" className="realtime-section-panel" hidden={!openSectionSync}>
              <p className="realtime-section-hint muted">
                勾選要自動同步的場次後啟動；或執行一次全場同步。
              </p>
              <div className="realtime-section-body realtime-section-sync">
                {!status?.legacyFullInterval && status?.oddsSyncEnabled !== false && raceNumbers.length > 0 && (
                  <div className="realtime-interval-races">
                    <span className="field-label">自動同步場次</span>
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
                <div className="realtime-section-sync-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => runServerSync()}
                    disabled={syncLoading || status?.oddsSyncEnabled === false}
                    title="一次同步所有可用場次"
                  >
                    {syncLoading ? "同步中…" : "全場同步（一次）"}
                  </button>
                  {!status?.legacyFullInterval && (
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
                      title="以伺服器週期輪詢勾選場次"
                    >
                      {intervalSyncLoading ? "…" : "啟動定時同步（所選場次）"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="realtime-section" aria-labelledby="realtime-heading-tools">
            <h3 id="realtime-heading-tools" className="realtime-section-title">
              <button
                type="button"
                className="realtime-section-toggle"
                aria-expanded={openSectionTools}
                aria-controls="realtime-panel-tools"
                onClick={() => setOpenSectionTools((v) => !v)}
              >
                <span className="realtime-section-toggle-text">資料工具</span>
                <span className="realtime-section-chevron" aria-hidden>
                  {openSectionTools ? "▼" : "▶"}
                </span>
              </button>
            </h3>
            <div id="realtime-panel-tools" className="realtime-section-panel" hidden={!openSectionTools}>
              <p className="realtime-section-hint muted">
                管理伺服器同步週期與批次馬匹資料更新。
              </p>
              <div className="realtime-section-body realtime-section-tools">
                {settings?.oddsSyncEnabled !== false && (
                  <div className="realtime-section-tools-worker">
                    <button type="button" className="btn-secondary" onClick={applyServerInterval}>
                      套用目前刷新頻率到伺服器
                    </button>
                    {settings && (
                      <span className="muted realtime-section-tools-meta">
                        Server worker: {settings.workerIntervalMs} ms
                      </span>
                    )}
                    {settingsMsg && <span className="realtime-section-tools-msg">{settingsMsg}</span>}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => runBulkHorseDetails()}
                  disabled={bulkHorseDetailsLoading || !meetingDate || !venueCode || raceNumbers.length === 0}
                  title="Load racecards for every race in this meeting, then run horse-details on all distinct codes with skip-scraped disabled (full re-upsert for this list)"
                >
                  {bulkHorseDetailsLoading ? "整理中…" : "更新全場馬匹歷史"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {(bulkHorseDetailsErr || bulkHorseDetailsMsg) && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            {bulkHorseDetailsErr && <p className="error-text" style={{ margin: 0 }}>{bulkHorseDetailsErr}</p>}
            {bulkHorseDetailsMsg && (
              <p className="muted" style={{ margin: bulkHorseDetailsErr ? "8px 0 0" : 0 }}>
                {bulkHorseDetailsMsg}{" "}
                <Link to="/scraper">前往 Scraper</Link> 查看即時日誌。
                {watchHorseDetailsScraper && (
                  <span className="text-info"> 仍在執行中…</span>
                )}
              </p>
            )}
          </div>
        )}

        {meetingsErr && <p className="error-text">{meetingsErr}</p>}
        {histErr && <p className="error-text">{histErr}</p>}
        {loading && <p className="muted">載入快照中…</p>}
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          目前資料：<strong>{meetingDate || "—"}</strong> · <strong>{venueCode || "—"}</strong> · 第 <strong>{raceNo}</strong>{" "}
          場，共 <strong>{history.length}</strong> 筆快照
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Race field (HKJC racecard)
          </h3>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCompareWithField}
            disabled={raceRunners.length === 0 || raceRunnersLoading}
            title={
              raceRunners.length === 0
                ? "Load runners first (racecard may not be available yet)"
                : `Open Compare with up to ${MAX_COMPARE_HORSES} horses from this race`
            }
          >
            Open in Compare
          </button>
        </div>
        <p className="muted" style={{ margin: "8px 0 0 0", fontSize: 13, maxWidth: 720 }}>
          <strong>Fetch horse history (all races)</strong> 會整理本場次全部馬匹並更新歷史資料，方便後續在 Analysis 與智能分析使用。
        </p>
        {raceRunnersLoading && <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>Loading runners…</p>}
        {raceRunnersErr && (
          <p className="error-text" style={{ margin: "8px 0 0", fontSize: 13 }}>
            {raceRunnersErr}
          </p>
        )}
        {!raceRunnersLoading && !raceRunnersErr && raceRunners.length === 0 && meetingDate && venueCode && (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            No runners with horse codes for this race yet (check meeting date/venue or try again after the racecard is published).
          </p>
        )}
        {raceRunners.length > 0 && (
          <div
            style={{
              marginTop: 10,
              maxHeight: 160,
              overflowY: "auto",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-card)",
              fontSize: 12,
            }}
          >
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 72 }}>#</th>
                  <th>Horse</th>
                  <th style={{ width: 96 }} title="HKJC horse code, e.g. L360">
                    Horse code
                  </th>
                </tr>
              </thead>
              <tbody>
                {raceRunners.map((r) => {
                  const backup = isRacecardBackup(r);
                  return (
                  <tr key={r.horse_code || `${r.no}-${r.horse_name}`}>
                    <td
                      className={backup ? "muted" : undefined}
                      title={
                        backup
                          ? r.standby_no
                            ? `後備馬（Standby ${r.standby_no}）`
                            : "後備馬（Standby）"
                          : `馬號 ${r.no}`
                      }
                    >
                      {formatRacecardHorseNo(r)}
                    </td>
                    <td>{r.horse_name}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{formatHorseCodeDisplay(r.horse_code)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
          <RealtimeLatestOddsCard tablePool={tablePool} rows={tableRows} theme={theme} />
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
          <RealtimeLatestOddsCard tablePool={tablePool} rows={tableRows} theme={theme} />
        </div>
      )}

      <p className="muted realtime-page-intro" style={{ marginTop: 28, marginBottom: 0, fontSize: 13, lineHeight: 1.55 }}>
        建議先選定場次，再啟動定時同步；若要快速補齊資料，可使用「全場同步（一次）」。
      </p>
    </div>
  );
}
