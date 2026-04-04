import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client.ts";
import MultiDateCalendar from "../components/MultiDateCalendar.tsx";

type ScriptKey = "historical" | "horse-details";

interface RunningInfo {
  pid: number;
  startedAt: string;
  logTail: string[];
}

interface LastRunInfo {
  exitCode: number | null;
  endedAt: string;
  logTail: string[];
}

interface ScriptStatus {
  script: string;
  scraperRoot: string;
  running: RunningInfo | null;
  lastRun: LastRunInfo | null;
}

type StatusPayload = Record<ScriptKey, ScriptStatus>;

function parseHorseCodeList(s: string): string[] {
  if (!s.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of s.split(/[\s,]+/)) {
    const t = part.trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export default function Scraper() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ScriptKey | null>(null);
  const [historicalDates, setHistoricalDates] = useState<string[]>([]);
  const [horseCodesRaw, setHorseCodesRaw] = useState("");

  const refresh = useCallback(() => {
    apiFetch<StatusPayload>("/api/scraper/status")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    const anyRunning =
      status.historical?.running != null || status["horse-details"]?.running != null;
    if (!anyRunning) return;
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [status, refresh]);

  async function start(script: ScriptKey) {
    setError(null);
    setBusy(script);
    try {
      const dates = script === "historical" ? historicalDates : [];
      const horseCodes = script === "horse-details" ? parseHorseCodeList(horseCodesRaw) : [];
      await apiFetch<{ ok: boolean; message?: string }>("/api/scraper/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          script === "historical"
            ? { script, ...(dates.length ? { dates } : {}) }
            : script === "horse-details"
              ? { script, ...(horseCodes.length ? { horseCodes } : {}) }
              : { script }
        ),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>Scraper jobs</h2>
      <p style={{ margin: "0 0 20px", color: "#94a3b8", fontSize: 14, maxWidth: 720 }}>
        Run the HKJC data collectors on the machine where the backend is running. Historical fills race
        results and dividends; horse-details loads profiles and race history for chosen horse codes, or all
        distinct codes from <code>hkjc_horse_race_history</code> when you leave the list empty. Logs below are
        a recent tail only.
      </p>

      {error && (
        <div className="card" style={{ marginBottom: 16, border: "1px solid rgba(248, 113, 113, 0.35)" }}>
          <div style={{ color: "#fca5a5", fontSize: 14 }}>{error}</div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 className="card-title">Historical results</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "#94a3b8" }}>
            <code>npm run historical</code> — local meeting discovery, race results, dividends, events.
          </p>
          <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#94a3b8" }}>
            Race dates (optional — click days in the calendar; multi-select)
          </label>
          <MultiDateCalendar
            value={historicalDates}
            onChange={setHistoricalDates}
            disabled={busy !== null || status?.historical?.running != null}
          />
          <p style={{ margin: "12px 0 16px", fontSize: 12, color: "#64748b" }}>
            Leave empty to scrape the latest Wednesday and Sunday before today (Hong Kong time). If data for a
            chosen date already exists in the database, the run is rejected.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || status?.historical?.running != null}
            onClick={() => start("historical")}
          >
            {status?.historical?.running ? "Running…" : "Run historical scraper"}
          </button>
        </div>

        <div className="card">
          <h3 className="card-title">Horse details</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "#94a3b8" }}>
            <code>npm run horse-details</code> — profiles and race history from HKJC horse pages.
          </p>
          <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#94a3b8" }}>
            Horse codes (optional, comma or whitespace separated)
          </label>
          <input
            type="text"
            style={{
              width: "100%",
              maxWidth: 420,
              marginBottom: 8,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "#0f172a",
              color: "#e2e8f0",
              fontSize: 14,
            }}
            placeholder="e.g. A123, B456"
            value={horseCodesRaw}
            onChange={(e) => setHorseCodesRaw(e.target.value)}
            disabled={busy !== null || status?.["horse-details"]?.running != null}
          />
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>
            Leave empty to scrape every distinct <code>horse_code</code> in <code>hkjc_horse_race_history</code>.
            Use <code>SCRAPER_HORSE_CODES_SOURCE=file</code> in the environment for the legacy{" "}
            <code>horse_codes_unique.txt</code> list instead.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || status?.["horse-details"]?.running != null}
            onClick={() => start("horse-details")}
          >
            {status?.["horse-details"]?.running ? "Running…" : "Run horse-details scraper"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={refresh}>
          Refresh status
        </button>
        {status?.historical && (
          <span style={{ marginLeft: 12, fontSize: 13, color: "#64748b" }}>
            Scraper root: {status.historical.scraperRoot}
          </span>
        )}
      </div>

      {status && (
        <div className="grid-2">
          <LogPanel title="Historical (live / last)" s={status.historical} />
          <LogPanel title="Horse-details (live / last)" s={status["horse-details"]} />
        </div>
      )}
    </div>
  );
}

function LogPanel({ title, s }: { title: string; s: ScriptStatus }) {
  const lines =
    s.running?.logTail?.length ? s.running.logTail : s.lastRun?.logTail?.length ? s.lastRun.logTail : [];
  const meta = s.running
    ? `PID ${s.running.pid} · started ${s.running.startedAt}`
    : s.lastRun
      ? `Exit ${s.lastRun.exitCode ?? "?"} · ended ${s.lastRun.endedAt}`
      : "No runs yet this session";

  return (
    <div className="card">
      <h3 className="card-title">{title}</h3>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>{meta}</div>
      <pre
        style={{
          margin: 0,
          maxHeight: 280,
          overflow: "auto",
          fontSize: 11,
          lineHeight: 1.45,
          background: "#0f172a",
          padding: 12,
          borderRadius: 8,
          color: "#cbd5e1",
        }}
      >
        {lines.length ? lines.join("\n") : "—"}
      </pre>
    </div>
  );
}
