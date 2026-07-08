import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { apiFetch } from "../api/client.ts";
import PageHeader from "../components/PageHeader.tsx";
import RaceTimeContext from "../components/RaceTimeContext.tsx";
import OddsSyncChips from "../components/OddsSyncChips.tsx";
import {
  readSharedMeetingRace,
  resolveMeetingIndex,
  resolveRaceNo,
  writeSharedMeetingRace,
} from "../lib/pageSessionPrefs.ts";
import { useCouncilSocket, type WsEnvelope } from "../hooks/useCouncilSocket.ts";
import { useNowTick } from "../hooks/useNowTick.ts";

interface ActiveRace {
  no?: string;
  postTime?: string;
  status?: string;
}
interface ActiveMeeting {
  date?: string;
  venueCode?: string;
  races?: ActiveRace[];
}
interface MeetingsResponse {
  meetings: ActiveMeeting[];
}
interface CouncilMessage {
  id: number;
  session_id?: number;
  seq: number;
  role: string;
  content: string;
  meta_json?: Record<string, unknown>;
  created_at_utc?: string;
  created_at_hkt?: string;
}
interface PickRow {
  combo: string;
  odds?: string;
  product?: string;
  reason_zh: string;
  reason_en: string;
  ev_status?: string;
}
interface CouncilPicks {
  summary_zh?: string;
  summary_en?: string;
  qpl?: PickRow[];
  others?: PickRow[];
  confidence?: number;
  updated_at_hkt?: string;
  _status?: {
    is_interim?: boolean;
    is_final?: boolean;
    round_no?: number;
  };
}

interface CouncilSessionRow {
  session_id: number;
  meeting_date: string;
  venue_code: string;
  race_no: number;
  status: string;
  trigger?: string;
  started_at_utc?: string | null;
  stopped_at_utc?: string | null;
  stop_reason?: string | null;
  message_count?: number;
}

interface SessionListResponse {
  items: CouncilSessionRow[];
}

interface CouncilTypingState {
  speaker: string;
  roundNo: number;
  turnNo: number;
}

function asText(v: unknown) {
  return typeof v === "string" ? v : "";
}

function normalizeMessageContent(input: string) {
  // Some model responses include escaped line breaks.
  return input.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
}

function hktDisplay(isoUtc?: string, hktRaw?: string) {
  if (hktRaw) return `${hktRaw} (HKT)`;
  if (!isoUtc) return "—";
  const d = new Date(isoUtc);
  return `${d.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })} (HKT)`;
}

function parseNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const AGENT_STYLES: Record<string, { letter: string; color: string; name: string; title: string }> = {
  quant: { letter: "Q", color: "#2563eb", name: "Quant", title: "數據量化" },
  historian: { letter: "H", color: "#7c3aed", name: "Historian", title: "往績分析" },
  trend: { letter: "T", color: "#d97706", name: "Trend", title: "市場情緒" },
  scout: { letter: "S", color: "#059669", name: "Scout", title: "現場檢核" },
  kelly: { letter: "K", color: "#db2777", name: "Kelly", title: "會議秘書" },
  bookie: { letter: "L", color: "#dc2626", name: "Lead Analyst", title: "首席分析 · 主席" },
};

function agentStyle(code: string) {
  const c = String(code || "").trim().toLowerCase();
  return AGENT_STYLES[c] ?? { letter: "A", color: "#64748b", name: code || "AI", title: "" };
}

function speakerDisplayName(code: string) {
  return agentStyle(code).name;
}

function dispositionLabelZh(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key === "accepted") return "已採納";
  if (key === "parked") return "待定";
  if (key === "rejected") return "已駁回";
  return null;
}

interface CouncilCadence {
  sessionRunning: boolean;
  runningRound: boolean;
  finalized: boolean;
  lastRoundCompletedAtMs: number;
  roundMinGapMs: number;
}

function cadenceFromStatus(status: Record<string, unknown>): CouncilCadence {
  const activeSession = (status.active_session as Record<string, unknown> | null) ?? null;
  const sessionRunning = Boolean(activeSession?.session_id) && activeSession?.status !== "stopped";
  return {
    sessionRunning,
    runningRound: Boolean(activeSession?.running_round),
    finalized: Boolean(activeSession?.finalized),
    lastRoundCompletedAtMs: parseNum(activeSession?.last_round_completed_at_ms),
    roundMinGapMs: parseNum(status.round_min_gap_ms) || 30_000,
  };
}

function readRoundGapFromStatus(status: Record<string, unknown>) {
  const gapMs = parseNum(status.round_min_gap_ms);
  const bounds = status.round_gap_bounds as Record<string, unknown> | undefined;
  return {
    gapSeconds: gapMs > 0 ? Math.round(gapMs / 1000) : 30,
    minSeconds: parseNum(bounds?.min_seconds) || 15,
    maxSeconds: parseNum(bounds?.max_seconds) || 600,
  };
}

function cadenceFromEvent(ev: WsEnvelope): CouncilCadence {
  return {
    sessionRunning: parseNum(ev.session_id) > 0,
    runningRound: Boolean(ev.running_round),
    finalized: Boolean(ev.finalized),
    lastRoundCompletedAtMs: parseNum(ev.last_round_completed_at_ms),
    roundMinGapMs: parseNum(ev.round_min_gap_ms) || 30_000,
  };
}

const ROUND_GAP_PRESETS = [15, 30, 45, 60, 90, 120];

function formatNextRoundHint(cadence: CouncilCadence, nowMs: number, isTyping: boolean): string | null {
  if (!cadence.sessionRunning || cadence.finalized) return null;
  if (cadence.runningRound || isTyping) return "本輪進行中";
  if (cadence.lastRoundCompletedAtMs <= 0) return null;
  const remainingMs = cadence.lastRoundCompletedAtMs + cadence.roundMinGapMs - nowMs;
  if (remainingMs <= 0) return "下一輪即將開始";
  const secs = Math.ceil(remainingMs / 1000);
  return `約 ${secs} 秒後下一輪`;
}

function formatSessionStateText(status: Record<string, unknown>) {
  const activated = Boolean(status.activated_date);
  const activeSession = (status.active_session as Record<string, unknown> | null) ?? null;
  const running = Boolean(activeSession?.session_id);
  const roundNo = parseNum(activeSession?.round_no);
  const finalized = Boolean(activeSession?.finalized);
  if (finalized) return "已結案 FINAL";
  if (running) return roundNo > 0 ? `會議進行中 · Round ${roundNo}` : "會議進行中";
  return activated ? "未開始 · 全日自動開會已啟用" : "未開始";
}

const SYSTEM_FIX_ZH = /（系統修正：[^）]*）/g;
const SYSTEM_FIX_EN = /\(System correction[^)]*\)/g;

function splitSystemFix(reason: string) {
  const hasFix = /系統修正|System correction/.test(reason);
  const cleaned = reason.replace(SYSTEM_FIX_ZH, "").replace(SYSTEM_FIX_EN, "").trim();
  return { hasFix, cleaned };
}

type MergedPickRow = PickRow & { count: number };

function mergePickRows(rows: PickRow[]): MergedPickRow[] {
  const map = new Map<string, MergedPickRow>();
  for (const r of rows) {
    const key = `${r.product ?? ""}|${r.combo}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, { ...r, count: 1 });
    }
  }
  return [...map.values()];
}

export default function AiRecommendation() {
  const initialMeetingRace = useMemo(() => readSharedMeetingRace(), []);
  const [meetings, setMeetings] = useState<ActiveMeeting[]>([]);
  const [meetingsErr, setMeetingsErr] = useState<string | null>(null);
  const [meetingIdx, setMeetingIdx] = useState(0);
  const [raceNo, setRaceNo] = useState(initialMeetingRace?.raceNo ?? 1);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [manualError, setManualError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [picks, setPicks] = useState<CouncilPicks | null>(null);
  const [sessionStateText, setSessionStateText] = useState("尚未連線");
  const [draft, setDraft] = useState("");
  const [sessions, setSessions] = useState<CouncilSessionRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [pendingUserReply, setPendingUserReply] = useState(false);
  const [typingState, setTypingState] = useState<CouncilTypingState | null>(null);
  const [sessionsApiEnabled, setSessionsApiEnabled] = useState(true);
  const [dayAutoStart, setDayAutoStart] = useState(false);
  const [dayAutoStartBusy, setDayAutoStartBusy] = useState(false);
  const [roundGapSeconds, setRoundGapSeconds] = useState(30);
  const [roundGapDraft, setRoundGapDraft] = useState("30");
  const [roundGapBusy, setRoundGapBusy] = useState(false);
  const [roundGapMin, setRoundGapMin] = useState(15);
  const [roundGapMax, setRoundGapMax] = useState(600);
  const [roundGapEditingCustom, setRoundGapEditingCustom] = useState(false);
  const [cadence, setCadence] = useState<CouncilCadence>({
    sessionRunning: false,
    runningRound: false,
    finalized: false,
    lastRoundCompletedAtMs: 0,
    roundMinGapMs: 30_000,
  });
  const now = useNowTick(1000);
  const sessions404NotifiedRef = useRef(false);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const prevMsgCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  const loadMeetings = useCallback(() => {
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
      })
      .catch((e: Error) => {
        setMeetingsErr(e.message);
        setMeetings([]);
      })
      .finally(() => setLoadingMeetings(false));
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const meeting = meetings[meetingIdx] ?? null;
  const meetingDate = meeting?.date ? String(meeting.date).slice(0, 10) : "";
  const venueCode = meeting?.venueCode ? String(meeting.venueCode) : "";

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

  useEffect(() => {
    if (!raceNumbers.length) return;
    if (!raceNumbers.includes(raceNo)) setRaceNo(raceNumbers[0]);
  }, [raceNumbers, raceNo]);

  useEffect(() => {
    if (!meetingDate || !venueCode || !raceNo) return;
    writeSharedMeetingRace({ meetingDate, venueCode, raceNo });
  }, [meetingDate, venueCode, raceNo]);

  const raceKey = useMemo(
    () =>
      meetingDate && venueCode && Number.isFinite(raceNo)
        ? { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo }
        : null,
    [meetingDate, venueCode, raceNo]
  );
  const ws = useCouncilSocket(raceKey);

  const loadSessions = useCallback((showError = true) => {
    if (!raceKey || !sessionsApiEnabled) return Promise.resolve([]);
    return apiFetch<SessionListResponse>(
      `/api/council/sessions?meeting_date=${encodeURIComponent(raceKey.meeting_date)}&venue_code=${encodeURIComponent(
        raceKey.venue_code
      )}&race_no=${raceKey.race_no}&limit=20`
    )
      .then((r) => {
        const list = Array.isArray(r.items) ? r.items : [];
        setSessions(list);
        setSessionId((prev) => {
          if (prev && list.some((s) => s.session_id === prev)) return prev;
          return list[0]?.session_id ?? null;
        });
        return list;
      })
      .catch((e: Error) => {
        if (String(e.message || "").includes("API 404")) {
          setSessionsApiEnabled(false);
          setSessions([]);
          if (showError && !sessions404NotifiedRef.current) {
            sessions404NotifiedRef.current = true;
            setManualError("歷史 Session 服務暫不可用，已降級為即時模式。");
          }
        }
        return [];
      });
  }, [raceKey, sessionsApiEnabled]);

  const loadMessagesBySession = useCallback(
    (sid: number | null) => {
      if (!raceKey || !sid) return Promise.resolve();
      return apiFetch<{ items: CouncilMessage[] }>(
        `/api/council/messages?meeting_date=${encodeURIComponent(raceKey.meeting_date)}&venue_code=${encodeURIComponent(
          raceKey.venue_code
        )}&race_no=${raceKey.race_no}&session_id=${sid}&after_seq=0`
      )
        .then((r) => setMessages(Array.isArray(r.items) ? r.items : []))
        .catch(() => {});
    },
    [raceKey]
  );

  useEffect(() => {
    setMessages([]);
    setPicks(null);
    setSessionStateText("連線中...");
    setManualError(null);
    setSessions([]);
    setSessionId(null);
    setPendingUserReply(false);
    setTypingState(null);
    setCadence({
      sessionRunning: false,
      runningRound: false,
      finalized: false,
      lastRoundCompletedAtMs: 0,
      roundMinGapMs: 30_000,
    });
    setSessionsApiEnabled(true);
    sessions404NotifiedRef.current = false;
  }, [meetingDate, venueCode, raceNo]);

  useEffect(() => {
    if (!meetingDate || !venueCode || !raceNo) return;
    loadSessions(false).catch(() => {});
  }, [meetingDate, venueCode, raceNo, sessionsApiEnabled, loadSessions]);

  useEffect(() => {
    if (!sessionId) return;
    loadMessagesBySession(sessionId).catch(() => {});
  }, [sessionId, loadMessagesBySession]);

  const wsEventCursorRef = useRef(0);

  const handleWsEvent = useCallback((ev: WsEnvelope) => {
    if (ev.type === "error") {
      setManualError(asText(ev.message));
      return;
    }
    if (ev.type === "session_state") {
      const status = ev.status as Record<string, unknown> | undefined;
      if (status) {
        setSessionStateText(formatSessionStateText(status));
        setDayAutoStart(Boolean(status.activated_date));
        setCadence(cadenceFromStatus(status));
        const gap = readRoundGapFromStatus(status);
        setRoundGapSeconds(gap.gapSeconds);
        setRoundGapDraft(String(gap.gapSeconds));
        setRoundGapMin(gap.minSeconds);
        setRoundGapMax(gap.maxSeconds);
        setRoundGapEditingCustom(!ROUND_GAP_PRESETS.includes(gap.gapSeconds));
        const activeSession = (status.active_session as Record<string, unknown> | null) ?? null;
        const running = Boolean(activeSession?.session_id);
        if (running && parseNum(activeSession?.session_id) > 0) {
          const sid = parseNum(activeSession?.session_id);
          setSessionId((prev) => prev ?? sid);
        }
      }
      if (ev.picks && typeof ev.picks === "object") setPicks(ev.picks as CouncilPicks);
      const latestPicksObj = (status?.latest_picks as Record<string, unknown> | undefined)?.picks;
      if (latestPicksObj && typeof latestPicksObj === "object") {
        setPicks(latestPicksObj as CouncilPicks);
      }
      return;
    }
    if (ev.type === "messages_sync") {
      const items = Array.isArray(ev.items) ? (ev.items as CouncilMessage[]) : [];
      if (!items.length) return;
      const sid = parseNum((items[0] as unknown as { session_id?: number }).session_id);
      if (sessionId && sid && sid !== sessionId) return;
      setMessages(items);
      return;
    }
    if (ev.type === "agent_message") {
      const msg = (ev.message as CouncilMessage | undefined) ?? null;
      if (!msg) return;
      const msgSessionId = parseNum((msg as unknown as { session_id?: number }).session_id);
      if (sessionId && msgSessionId && msgSessionId !== sessionId) return;
      setMessages((prev) => [...prev, msg]);
      const speaker = asText(msg.meta_json?.speaker ?? msg.meta_json?.agent_code);
      setTypingState((prev) => {
        if (!prev) return prev;
        return prev.speaker === speaker ? null : prev;
      });
      if (speaker === "bookie" || msg.role === "agent") setPendingUserReply(false);
      return;
    }
    if (ev.type === "typing_update") {
      const sid = parseNum(ev.session_id);
      if (sessionId && sid && sid !== sessionId) return;
      const speaker = asText(ev.speaker);
      if (!speaker) return;
      const isTyping = Boolean(ev.is_typing);
      if (!isTyping) {
        setTypingState((prev) => {
          if (!prev) return prev;
          return prev.speaker === speaker ? null : prev;
        });
        return;
      }
      setTypingState({
        speaker,
        roundNo: parseNum(ev.round_no),
        turnNo: parseNum(ev.turn_no),
      });
      return;
    }
    if (ev.type === "cadence_update") {
      setCadence(cadenceFromEvent(ev));
      return;
    }
    if (ev.type === "round_gap_update") {
      const secs = parseNum(ev.round_min_gap_seconds);
      const ms = parseNum(ev.round_min_gap_ms);
      if (secs > 0) {
        setRoundGapSeconds(secs);
        setRoundGapDraft(String(secs));
      }
      if (ms > 0) setCadence((prev) => ({ ...prev, roundMinGapMs: ms }));
      return;
    }
    if (ev.type === "picks_update") {
      const p = (ev.picks as CouncilPicks | undefined) ?? null;
      if (p) setPicks(p);
      return;
    }
    if (ev.type === "date_activation") {
      const activated = ev.activated !== false;
      setDayAutoStart(activated);
      setSessionStateText(activated ? "全日自動開會已啟用 · 等待會議開始" : "全日自動開會已關閉");
    }
  }, [sessionId]);

  useEffect(() => {
    const pending = ws.events.filter((ev) => ev._seq > wsEventCursorRef.current);
    if (!pending.length) return;
    wsEventCursorRef.current = pending[pending.length - 1]._seq;
    for (const ev of pending) handleWsEvent(ev);
  }, [ws.events, handleWsEvent]);

  const refreshSessions = useCallback(() => {
    setSessionsApiEnabled(true);
    sessions404NotifiedRef.current = false;
    loadSessions(true).catch(() => {});
  }, [loadSessions]);

  useEffect(() => {
    if (!meetingDate || !venueCode || !raceNo) return;
    let stopped = false;
    const pollStatus = () => {
      apiFetch<Record<string, unknown>>(
        `/api/council/status?meeting_date=${encodeURIComponent(meetingDate)}&venue_code=${encodeURIComponent(
          venueCode
        )}&race_no=${raceNo}`
      )
        .then((status) => {
          if (stopped) return;
          setSessionStateText(formatSessionStateText(status));
          setDayAutoStart(Boolean(status.activated_date));
          setCadence(cadenceFromStatus(status));
          const gap = readRoundGapFromStatus(status);
          setRoundGapSeconds(gap.gapSeconds);
          setRoundGapDraft(String(gap.gapSeconds));
          setRoundGapMin(gap.minSeconds);
          setRoundGapMax(gap.maxSeconds);
          setRoundGapEditingCustom(!ROUND_GAP_PRESETS.includes(gap.gapSeconds));
          const activeSession = (status.active_session as Record<string, unknown> | null) ?? null;
          const sid = parseNum(activeSession?.session_id);
          if (sid > 0) setSessionId((prev) => prev ?? sid);
          const latestPicksObj = (status.latest_picks as Record<string, unknown> | undefined)?.picks;
          if (latestPicksObj && typeof latestPicksObj === "object") setPicks(latestPicksObj as CouncilPicks);
        })
        .catch(() => {
          if (!stopped && !ws.connected) setSessionStateText("WebSocket 未連線（重試中）");
        });
    };
    pollStatus();
    const t = window.setInterval(pollStatus, 8000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [meetingDate, venueCode, raceNo, ws.connected]);

  const startCouncil = useCallback(() => {
    if (!ws.start()) setManualError("WebSocket 尚未連線");
  }, [ws]);

  const toggleDayAutoStart = useCallback(() => {
    if (!meetingDate) return;
    const next = !dayAutoStart;
    setDayAutoStartBusy(true);
    apiFetch<{ ok: boolean; activated: boolean }>("/api/council/activate-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_date: meetingDate, enabled: next }),
    })
      .then((r) => setDayAutoStart(Boolean(r.activated)))
      .catch((e: Error) => setManualError(e.message))
      .finally(() => setDayAutoStartBusy(false));
  }, [meetingDate, dayAutoStart]);

  const applyRoundGap = useCallback(
    (seconds: number) => {
      const clamped = Math.min(roundGapMax, Math.max(roundGapMin, Math.round(seconds)));
      if (!Number.isFinite(clamped)) return;
      setRoundGapBusy(true);
      apiFetch<{ ok: boolean; round_min_gap_seconds: number; round_min_gap_ms: number }>(
        "/api/council/round-gap",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gap_seconds: clamped }),
        }
      )
        .then((r) => {
          const secs = parseNum(r.round_min_gap_seconds) || clamped;
          const ms = parseNum(r.round_min_gap_ms) || secs * 1000;
          setRoundGapSeconds(secs);
          setRoundGapDraft(String(secs));
          setCadence((prev) => ({ ...prev, roundMinGapMs: ms }));
          setRoundGapEditingCustom(!ROUND_GAP_PRESETS.includes(secs));
        })
        .catch((e: Error) => setManualError(e.message))
        .finally(() => setRoundGapBusy(false));
    },
    [roundGapMin, roundGapMax]
  );

  const stopCouncil = useCallback(() => {
    if (!ws.stop()) setManualError("WebSocket 尚未連線");
  }, [ws]);

  const submitMessage = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      const ok = ws.sendUserMessage(text);
      if (!ok) {
        setManualError("訊息發送失敗，請確認連線狀態。");
        return;
      }
      setDraft("");
      setPendingUserReply(true);
    },
    [draft, ws]
  );

  const renderedMessages = useMemo(() => {
    let lastRound = -1;
    return messages.map((m) => {
      const meta = m.meta_json ?? {};
      const roundNo = parseNum(meta.round_no);
      const showRoundDivider = roundNo > 0 && roundNo !== lastRound;
      if (roundNo > 0) lastRound = roundNo;
      return {
        message: m,
        meta,
        roundNo,
        turnNo: parseNum(meta.turn_no),
        replyToSeq: parseNum(meta.reply_to_seq),
        showRoundDivider,
      };
    });
  }, [messages]);

  const scrollChatToBottom = useCallback(() => {
    const el = chatListRef.current;
    if (!el) return;
    // Two rAFs so the scroll happens after markdown/layout has painted.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  const onChatScroll = useCallback(() => {
    const el = chatListRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = nearBottom;
    if (nearBottom) setUnseenCount(0);
  }, []);

  useEffect(() => {
    const added = messages.length - prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;
    if (stickToBottomRef.current) {
      scrollChatToBottom();
      setUnseenCount(0);
    } else if (added > 0) {
      setUnseenCount((n) => n + added);
    }
  }, [messages, typingState, scrollChatToBottom]);

  const renderPickRow = (r: MergedPickRow, key: string, showProduct: boolean) => {
    const { hasFix, cleaned } = splitSystemFix(asText(r.reason_zh) || asText(r.reason_en) || "");
    return (
      <li key={key} className="ai-picks-row">
        <div className="ai-picks-row-main">
          {showProduct && r.product ? <span className="ai-picks-product">{r.product}</span> : null}
          <span className="ai-picks-combo">{r.combo}</span>
          {r.odds ? <span className="ai-picks-odds">@ {r.odds}</span> : null}
          <span className="ai-picks-row-badges">
            {r.count > 1 && <span className="ai-picks-badge">×{r.count}</span>}
            {r.ev_status === "negative" && <span className="ai-picks-badge warn">EV−</span>}
            {hasFix && <span className="ai-picks-badge fix">系統修正</span>}
          </span>
        </div>
        {cleaned ? <p className="ai-picks-reason muted">{cleaned}</p> : null}
      </li>
    );
  };

  const picksRoundNo = parseNum(picks?._status?.round_no);
  const qplRows = mergePickRows(picks?.qpl ?? []);
  const otherRows = mergePickRows(picks?.others ?? []);

  const confidencePct =
    picks && typeof picks.confidence === "number" && Number.isFinite(picks.confidence)
      ? Math.round(Math.min(1, Math.max(0, picks.confidence)) * 100)
      : null;

  const nextRoundHint = formatNextRoundHint(cadence, now.getTime(), Boolean(typingState));
  const roundGapSelectValue =
    ROUND_GAP_PRESETS.includes(roundGapSeconds) && !roundGapEditingCustom
      ? String(roundGapSeconds)
      : "custom";
  const showCustomGapEditor = roundGapEditingCustom || !ROUND_GAP_PRESETS.includes(roundGapSeconds);

  return (
    <div className="ai-rec-page">
      <PageHeader title="智能分析（AI）" subtitle="AI 議會即時分析本場賽事，開跑前發布共識。" />

      <div className="card ai-council-statusbar">
        <div className="ai-council-status-head">
          <div className="ai-council-status-race">
            <span className="ai-council-race-title">
              {meetingDate && venueCode ? `${meetingDate} · ${venueCode} · 第 ${raceNo} 場` : "尚未選擇場次"}
            </span>
          </div>
          {meetingDate && venueCode ? (
            <RaceTimeContext meetingDate={meetingDate} race={selectedRace} variant="compact" />
          ) : null}
        </div>
        <div className="ai-council-status-rows">
          <span className={`ai-council-chip ${sessionStateText.includes("進行中") ? "live" : ""}`}>
            {sessionStateText}
          </span>
          {nextRoundHint ? (
            <span className={`ai-council-chip cadence ${cadence.runningRound || typingState ? "live" : ""}`}>
              {nextRoundHint}
            </span>
          ) : null}
          <span className="ai-council-status-divider" aria-hidden="true" />
          <span className={`ai-council-chip ${ws.connected ? "ok" : "warn"}`}>
            {ws.connected ? "即時連線" : "連線中斷"}
          </span>
          <OddsSyncChips
            race={
              meetingDate && venueCode
                ? { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo }
                : null
            }
            councilRunning={cadence.sessionRunning && !cadence.finalized}
          />
        </div>
      </div>

      <div className="card ai-rec-action-card ai-council-layout">
        <div className="ai-council-toolbar">
          <section className="ai-council-toolbar-section" aria-label="場次與控制">
            <h3 className="ai-council-toolbar-section-title">場次</h3>
            <div className="ai-council-field">
              <label className="field-label" htmlFor="council-meeting">
                賽馬日／場地
              </label>
              <select
                id="council-meeting"
                className="ai-council-select"
                value={meetingIdx}
                onChange={(e) => setMeetingIdx(Number(e.target.value))}
                disabled={!meetings.length || loadingMeetings}
              >
                {meetings.map((m, i) => (
                  <option key={`${m.date}-${m.venueCode}-${i}`} value={i}>
                    {String(m.date).slice(0, 10)} · {m.venueCode}
                  </option>
                ))}
              </select>
            </div>
            <div className="ai-council-field ai-council-field-race">
              <label className="field-label" htmlFor="council-race">
                場次
              </label>
              <select
                id="council-race"
                className="ai-council-select ai-council-select-race"
                value={raceNo}
                onChange={(e) => setRaceNo(Number(e.target.value))}
                disabled={!raceNumbers.length}
              >
                {raceNumbers.map((n) => (
                  <option key={n} value={n}>
                    第 {n} 場
                  </option>
                ))}
              </select>
            </div>
            <div className="ai-council-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={startCouncil}
                disabled={!meetingDate}
                title="啟動或恢復本場 AI 議會"
              >
                啟動議會
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={stopCouncil}
                disabled={!meetingDate}
                title="暫停本場會議"
              >
                停止
              </button>
            </div>
          </section>

          <section className="ai-council-toolbar-section" aria-label="議會設定">
            <h3 className="ai-council-toolbar-section-title">設定</h3>
            <button
              type="button"
              className={`ai-council-toggle ${dayAutoStart ? "on" : ""}`}
              onClick={toggleDayAutoStart}
              disabled={!meetingDate || dayAutoStartBusy}
              title="開啟後，當日各場會在開跑前自動召開會議"
              aria-pressed={dayAutoStart}
            >
              <span className="ai-council-toggle-indicator" aria-hidden="true" />
              <span>全日自動開會</span>
            </button>
            <div className="ai-council-field ai-council-field-interval">
              <label className="field-label" htmlFor="council-round-gap">
                回合間隔
              </label>
              <div className="ai-council-interval-row">
                <select
                  id="council-round-gap"
                  className="ai-council-select"
                  value={roundGapSelectValue}
                  disabled={roundGapBusy}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "custom") {
                      setRoundGapEditingCustom(true);
                      return;
                    }
                    setRoundGapEditingCustom(false);
                    applyRoundGap(Number(v));
                  }}
                >
                  {ROUND_GAP_PRESETS.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec} 秒
                    </option>
                  ))}
                  <option value="custom">自訂</option>
                </select>
                {showCustomGapEditor ? (
                  <>
                    <input
                      type="number"
                      className="ai-council-interval-input"
                      min={roundGapMin}
                      max={roundGapMax}
                      step={1}
                      value={roundGapDraft}
                      disabled={roundGapBusy}
                      aria-label="自訂回合間隔秒數"
                      onChange={(e) => setRoundGapDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyRoundGap(parseNum(roundGapDraft));
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost ai-council-interval-apply"
                      disabled={roundGapBusy}
                      onClick={() => applyRoundGap(parseNum(roundGapDraft))}
                    >
                      套用
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="ai-council-field ai-council-field-history">
              <label className="field-label" htmlFor="council-session">
                歷史會議
              </label>
              <div className="ai-council-history-row">
                <select
                  id="council-session"
                  className="ai-council-select ai-council-select-history"
                  value={sessionId ?? ""}
                  onChange={(e) => setSessionId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!sessions.length}
                >
                  {sessions.length === 0 ? (
                    <option value="">無紀錄</option>
                  ) : (
                    sessions.map((s) => (
                      <option key={s.session_id} value={s.session_id}>
                        #{s.session_id} · {s.message_count ?? 0} 則 · {s.status === "running" ? "進行中" : "已結束"}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost ai-council-refresh-btn"
                  onClick={refreshSessions}
                  disabled={!meetingDate || !venueCode}
                  title="刷新會議列表"
                >
                  刷新
                </button>
              </div>
            </div>
          </section>
        </div>
        <section className="ai-council-chat-panel">
          <header className="ai-council-panel-header">
            <div className="ai-council-panel-heading">
              <h3 className="ai-council-panel-title">議會聊天室</h3>
              <p className="ai-council-panel-subtitle muted">與分析師即時討論；提問可 @kelly</p>
            </div>
            <span className="ai-council-panel-meta">
              {messages.length > 0 ? `${messages.length} 則訊息` : "等待開場"}
            </span>
          </header>

          <div className="ai-council-chat-wrap">
            <div className="ai-council-chat-list" ref={chatListRef} onScroll={onChatScroll}>
              {messages.length === 0 && !typingState ? (
                <div className="ai-council-chat-empty">
                  <p className="ai-council-chat-empty-title">尚無會議記錄</p>
                  <p className="muted">按「啟動議會」開始本場分析，或直接輸入你的問題。</p>
                </div>
              ) : (
                renderedMessages.map((row) => {
                  const m = row.message;
                  const meta = row.meta;
                  const speaker = asText(meta.speaker || meta.agent_code);
                  const isUser = m.role === "user";
                  const isSystem = m.role === "system" || speaker === "system";
                  const normalizedContent = normalizeMessageContent(m.content);
                  if (isSystem) {
                    return (
                      <div key={`${m.id}-${m.seq}`} className="ai-council-msg-block">
                        {row.showRoundDivider ? (
                          <div className="ai-council-round-divider-wrap">
                            <span className="ai-council-round-divider">第 {row.roundNo} 輪</span>
                          </div>
                        ) : null}
                        <div className="ai-council-system-msg">{normalizedContent}</div>
                      </div>
                    );
                  }
                  const style = agentStyle(speaker);
                  const userName = asText(meta.username) || "你";
                  const who = isUser ? userName : style.name;
                  const lineCount = normalizedContent ? normalizedContent.split("\n").length : 0;
                  const isLongMessage = normalizedContent.length > 1400 || lineCount > 26;
                  const messageBody = <ReactMarkdown>{normalizedContent || "（空內容）"}</ReactMarkdown>;
                  const disposition = dispositionLabelZh(asText(meta.bookie_disposition));
                  return (
                    <div key={`${m.id}-${m.seq}`} className="ai-council-msg-block">
                      {row.showRoundDivider ? (
                        <div className="ai-council-round-divider-wrap">
                          <span className="ai-council-round-divider">第 {row.roundNo} 輪</span>
                        </div>
                      ) : null}
                      <article className={`ai-council-msg ${isUser ? "user" : "agent"}`}>
                        {!isUser ? (
                          <span className="ai-council-avatar" style={{ backgroundColor: style.color }} aria-hidden="true">
                            {style.letter}
                          </span>
                        ) : null}
                        <div className="ai-council-msg-body">
                          <header className="ai-council-msg-head">
                            <div className="ai-council-msg-who">
                              <strong style={!isUser ? { color: style.color } : undefined}>{who}</strong>
                              {!isUser && style.title ? (
                                <span className="ai-council-role muted">{style.title}</span>
                              ) : null}
                            </div>
                            <span className="muted ai-council-msg-time">
                              {hktDisplay(m.created_at_utc, m.created_at_hkt)}
                              {disposition ? ` · ${disposition}` : null}
                            </span>
                          </header>
                          {isLongMessage ? (
                            <details className="ai-council-msg-collapsible" open={m.role === "user"}>
                              <summary>展開完整內容（{lineCount} 行）</summary>
                              <div className="ai-council-msg-content">{messageBody}</div>
                            </details>
                          ) : (
                            <div className="ai-council-msg-content">{messageBody}</div>
                          )}
                        </div>
                        {isUser ? (
                          <span className="ai-council-avatar ai-council-avatar-user" aria-hidden="true">
                            你
                          </span>
                        ) : null}
                      </article>
                    </div>
                  );
                })
              )}
              {typingState && (
                <article className="ai-council-msg agent ai-council-msg-typing">
                  <span
                    className="ai-council-avatar"
                    style={{ backgroundColor: agentStyle(typingState.speaker).color }}
                    aria-hidden="true"
                  >
                    {agentStyle(typingState.speaker).letter}
                  </span>
                  <div className="ai-council-msg-body">
                    <header className="ai-council-msg-head">
                      <div className="ai-council-msg-who">
                        <strong style={{ color: agentStyle(typingState.speaker).color }}>
                          {speakerDisplayName(typingState.speaker)}
                        </strong>
                        <span className="ai-council-role muted">正在輸入</span>
                      </div>
                    </header>
                    <div className="ai-council-msg-content">
                      <span className="ai-council-typing-dots" aria-label="正在輸入">
                        ...
                      </span>
                    </div>
                  </div>
                </article>
              )}
            </div>
            {unseenCount > 0 && (
              <button
                type="button"
                className="ai-council-jump-latest"
                onClick={() => {
                  stickToBottomRef.current = true;
                  setUnseenCount(0);
                  scrollChatToBottom();
                }}
              >
                {unseenCount} 則新訊息 ↓
              </button>
            )}
          </div>

          <footer className="ai-council-composer">
            <label className="field-label" htmlFor="council-message-input">
              你的發言
            </label>
            <form className="ai-council-input-row" onSubmit={submitMessage}>
              <input
                id="council-message-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  pendingUserReply ? "議會回應中，可繼續補充…" : "輸入問題或指示（例如：@kelly 而家邊匹最穩？）"
                }
              />
              <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
                發送
              </button>
            </form>
          </footer>
        </section>

        <aside className={`ai-council-picks-panel card ${picks?._status?.is_final ? "final" : ""}`}>
          <header className="ai-council-panel-header ai-council-picks-header">
            <div className="ai-council-panel-heading">
              <h3 className="ai-council-panel-title">會議即時共識</h3>
              <p className="ai-council-panel-subtitle muted">首席分析師本輪綜合結論</p>
            </div>
            {picks ? (
              <span className={`ai-picks-badge ${picks._status?.is_final ? "final" : "interim"}`}>
                {picks._status?.is_final ? "FINAL" : "進行中"}
              </span>
            ) : null}
          </header>

          {picks ? (
            <div className="ai-council-picks-body">
              <div className="ai-council-picks-meta">
                {picksRoundNo > 0 ? <span>第 {picksRoundNo} 輪</span> : null}
                {picks.updated_at_hkt ? <span>{picks.updated_at_hkt} HKT 更新</span> : null}
              </div>

              {(picks.summary_zh || picks.summary_en) && (
                <div className="ai-council-picks-summary-card">
                  <p className="ai-picks-summary">{picks.summary_zh || picks.summary_en}</p>
                </div>
              )}

              {confidencePct != null && (
                <div className="ai-picks-confidence">
                  <div className="ai-picks-confidence-label">
                    <span className="muted">信心指數</span>
                    <strong>{confidencePct}%</strong>
                  </div>
                  <div className="ai-picks-confidence-track">
                    <div className="ai-picks-confidence-fill" style={{ width: `${confidencePct}%` }} />
                  </div>
                </div>
              )}

              <section className="ai-council-picks-section">
                <h4 className="ai-council-picks-section-title">位置 Q 主攻</h4>
                {qplRows.length ? (
                  <ul className="ai-picks-list">
                    {qplRows.map((r, i) => renderPickRow(r, `qpl-${i}`, false))}
                  </ul>
                ) : (
                  <p className="ai-council-picks-empty muted">本輪尚未有 QPL 建議</p>
                )}
              </section>

              <section className="ai-council-picks-section">
                <h4 className="ai-council-picks-section-title">其他彩池</h4>
                {otherRows.length ? (
                  <ul className="ai-picks-list">
                    {otherRows.map((r, i) => renderPickRow(r, `other-${i}`, true))}
                  </ul>
                ) : (
                  <p className="ai-council-picks-empty muted">本輪尚未有其他彩池建議</p>
                )}
              </section>
            </div>
          ) : (
            <div className="ai-council-picks-empty-state">
              <p className="ai-council-picks-empty-title">尚無共識</p>
              <p className="muted">議會開始後，每輪總結會顯示於此。</p>
            </div>
          )}
        </aside>
        {meetingsErr && <p className="error-text ai-rec-error-line ai-council-layout-full">{meetingsErr}</p>}
        {manualError && <p className="error-text ai-rec-error-line ai-council-layout-full">{manualError}</p>}
      </div>

      <footer className="ai-rec-footnote muted">所有時間以香港時間（HKT, UTC+8）顯示。</footer>
    </div>
  );
}
