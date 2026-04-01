import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client.ts";

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

export default function Scraper() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ScriptKey | null>(null);

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
      await apiFetch<{ ok: boolean; message?: string }>("/api/scraper/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
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
        results and dividends; horse-details loads profiles from <code>horse_codes_unique.txt</code>.
        Logs below are a recent tail only.
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
            <code>npm run horse-details</code> — profiles and race history from horse codes list.
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
