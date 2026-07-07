import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client.ts";
import PageHeader from "../components/PageHeader.tsx";

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
  const [historicalStartDate, setHistoricalStartDate] = useState("");
  const [historicalEndDate, setHistoricalEndDate] = useState("");
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
    if (script === "historical") {
      const hasStart = historicalStartDate.trim() !== "";
      const hasEnd = historicalEndDate.trim() !== "";
      if (hasStart !== hasEnd) {
        setError("請同時選擇開始與結束日期，或兩者皆留空以使用預設賽馬日。");
        return;
      }
      if (hasStart && hasEnd && historicalStartDate > historicalEndDate) {
        setError("開始日期不可晚於結束日期。");
        return;
      }
    }
    setBusy(script);
    try {
      const horseCodes = script === "horse-details" ? parseHorseCodeList(horseCodesRaw) : [];
      await apiFetch<{ ok: boolean; message?: string }>("/api/scraper/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          script === "historical"
            ? {
                script,
                ...(historicalStartDate && historicalEndDate
                  ? { startDate: historicalStartDate, endDate: historicalEndDate }
                  : {}),
              }
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
    <div className="scraper-page">
      <PageHeader title="Scraper jobs" subtitle="管理資料抓取任務與最近執行記錄。" />
      <p className="muted scraper-intro">在此啟動歷史賽果與馬匹資料抓取，並即時查看任務狀態。</p>

      <div className="card scraper-status-card">
        <p className="scraper-status-line">
          任務狀態：
          {status?.historical?.running || status?.["horse-details"]?.running ? (
            <span className="text-success"> 執行中</span>
          ) : (
            <span className="text-faint-inline"> 目前無執行中任務</span>
          )}
        </p>
        <button type="button" className="btn btn-ghost" onClick={refresh}>
          重新整理狀態
        </button>
      </div>

      {error && (
        <div className="card border-danger-soft scraper-error-banner">
          <div className="error-text">{error}</div>
        </div>
      )}

      <div className="grid-2 scraper-jobs-grid">
        <div className="card">
          <h3 className="card-title">Historical results</h3>
          <p className="muted scraper-card-desc">
            抓取歷史賽事結果與派彩資料。可指定日期區間，或留空使用系統預設賽馬日。
          </p>
          <div className="scraper-date-range">
            <div className="scraper-date-field">
              <label className="field-label" htmlFor="historical-start-date">
                開始日期
              </label>
              <input
                id="historical-start-date"
                type="date"
                className="scraper-input scraper-date-input"
                value={historicalStartDate}
                onChange={(e) => setHistoricalStartDate(e.target.value)}
                disabled={busy !== null || status?.historical?.running != null}
              />
            </div>
            <div className="scraper-date-field">
              <label className="field-label" htmlFor="historical-end-date">
                結束日期
              </label>
              <input
                id="historical-end-date"
                type="date"
                className="scraper-input scraper-date-input"
                value={historicalEndDate}
                min={historicalStartDate || undefined}
                onChange={(e) => setHistoricalEndDate(e.target.value)}
                disabled={busy !== null || status?.historical?.running != null}
              />
            </div>
          </div>
          <p className="text-faint-inline scraper-hint">
            區間內每一日都會嘗試抓取；無賽事的日期會自動略過。若資料已存在，任務會拒絕重複匯入。
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || status?.historical?.running != null}
            onClick={() => start("historical")}
          >
            {status?.historical?.running ? "執行中…" : "執行歷史抓取"}
          </button>
          {status && <LogPanel title="Historical 日誌" s={status.historical} />}
        </div>

        <div className="card">
          <h3 className="card-title">Horse details</h3>
          <p className="muted scraper-card-desc">
            抓取馬匹詳細資料與歷史紀錄。可輸入特定馬匹代碼，或留空由系統自動判斷。
          </p>
          <label className="scraper-label">馬匹代碼（可選，逗號或空白分隔）</label>
          <input
            type="text"
            className="scraper-input"
            placeholder="例如 A123, B456"
            value={horseCodesRaw}
            onChange={(e) => setHorseCodesRaw(e.target.value)}
            disabled={busy !== null || status?.["horse-details"]?.running != null}
          />
          <p className="text-faint-inline scraper-hint">
            留空時會抓取系統可識別的全部馬匹代碼。
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || status?.["horse-details"]?.running != null}
            onClick={() => start("horse-details")}
          >
            {status?.["horse-details"]?.running ? "執行中…" : "執行馬匹資料抓取"}
          </button>
          {status && <LogPanel title="Horse-details 日誌" s={status["horse-details"]} />}
        </div>
      </div>
    </div>
  );
}

function LogPanel({ title, s }: { title: string; s: ScriptStatus }) {
  const lines =
    s.running?.logTail?.length ? s.running.logTail : s.lastRun?.logTail?.length ? s.lastRun.logTail : [];
  const meta = s.running
    ? `PID ${s.running.pid} · 開始於 ${s.running.startedAt}`
    : s.lastRun
      ? `Exit ${s.lastRun.exitCode ?? "?"} · 結束於 ${s.lastRun.endedAt}`
      : "本次工作階段尚未執行";

  return (
    <div className="scraper-log-panel">
      <h3 className="card-title">{title}</h3>
      <div className="log-panel-meta">{meta}</div>
      <pre className="log-panel-pre">
        {lines.length ? lines.join("\n") : "—"}
      </pre>
    </div>
  );
}
