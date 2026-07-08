import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface RaceKey {
  meeting_date: string;
  venue_code: string;
  race_no: number;
}

export interface WsEnvelope {
  type: string;
  /** Monotonic sequence assigned client-side; lets consumers process every event exactly once. */
  _seq: number;
  [key: string]: unknown;
}

function resolveWsBase(): string {
  const envBase = String(import.meta.env.VITE_WS_URL ?? "").trim();
  if (envBase) {
    try {
      const parsed = new URL(envBase);
      const pageHost = window.location.hostname;
      const envHost = parsed.hostname;
      const pageIsLocal = pageHost === "localhost" || pageHost === "127.0.0.1";
      const envIsLocal = envHost === "localhost" || envHost === "127.0.0.1";
      // Guardrail A: remote page should not use localhost websocket target.
      // Guardrail B: local page should not use remote websocket target (cookie/domain mismatch).
      const isMismatchedLocality = (envIsLocal && !pageIsLocal) || (!envIsLocal && pageIsLocal);
      if (!isMismatchedLocality) {
        return envBase.replace(/\/$/, "");
      }
    } catch {
      // ignore invalid env base and fallback to same-origin
    }
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

function buildWsUrl(race: RaceKey): string {
  const base = resolveWsBase();
  const path = base.endsWith("/ws") ? `${base}/council` : `${base}/ws/council`;
  const u = new URL(path);
  u.searchParams.set("meeting_date", race.meeting_date);
  u.searchParams.set("venue_code", race.venue_code);
  u.searchParams.set("race_no", String(race.race_no));
  return u.toString();
}

export function useCouncilSocket(race: RaceKey | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const eventSeqRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEnvelope | null>(null);
  const [events, setEvents] = useState<WsEnvelope[]>([]);

  const url = useMemo(() => {
    if (!race) return "";
    return buildWsUrl(race);
  }, [race]);

  useEffect(() => {
    setEvents([]);
    setLastEvent(null);
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data ?? "{}")) as { type?: string; [key: string]: unknown };
        eventSeqRef.current += 1;
        const msg: WsEnvelope = { ...parsed, type: String(parsed.type ?? ""), _seq: eventSeqRef.current };
        setLastEvent(msg);
        setEvents((prev) => [...prev.slice(-399), msg]);
      } catch {
        // ignore invalid payload
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [url]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  return {
    connected,
    lastEvent,
    events,
    send,
    start: () => send({ type: "start" }),
    stop: () => send({ type: "stop" }),
    sendUserMessage: (content: string) => send({ type: "user_message", content }),
  };
}

