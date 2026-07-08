import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.ts";

export interface SyncRaceKey {
  meeting_date: string;
  venue_code: string;
  race_no: number;
}

export interface OddsSyncStatusData {
  oddsSyncEnabled: boolean;
  lastSync?: {
    at: string;
    result: { inserted?: number; racesChecked?: number } | null;
    error: string | null;
  } | null;
  activeIntervalTargets?: SyncRaceKey[] | null;
  activeIntervalTarget?: SyncRaceKey | null;
  currentSync?: { kind: string; meeting_date: string; venue_code: string; race_no: number } | null;
  legacyFullInterval?: boolean;
}

function sameRace(a: SyncRaceKey, b: SyncRaceKey) {
  return (
    a.meeting_date === b.meeting_date &&
    a.venue_code === b.venue_code &&
    Number(a.race_no) === Number(b.race_no)
  );
}

/**
 * Live odds-sync worker status as compact chips.
 * Pass `status` to render from data the page already polls; otherwise the
 * component polls the status endpoint itself every `pollMs`.
 */
export default function OddsSyncChips({
  race = null,
  status: statusProp,
  pollMs = 5000,
  councilRunning = false,
}: {
  /** Highlight whether this race is included in the sync targets. */
  race?: SyncRaceKey | null;
  status?: OddsSyncStatusData | null;
  pollMs?: number;
  /** When true, this race has an active council session (expect sync to follow). */
  councilRunning?: boolean;
}) {
  const selfPolling = statusProp === undefined;
  const [polled, setPolled] = useState<OddsSyncStatusData | null>(null);

  useEffect(() => {
    if (!selfPolling) return;
    let stopped = false;
    const tick = () => {
      apiFetch<OddsSyncStatusData>("/api/realtime/status")
        .then((s) => {
          if (!stopped) setPolled(s);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, pollMs);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [selfPolling, pollMs]);

  const status = selfPolling ? polled : statusProp;
  if (!status) return null;

  const legacy = Boolean(status.legacyFullInterval);
  const targets = status.activeIntervalTargets?.length
    ? status.activeIntervalTargets
    : status.activeIntervalTarget
      ? [status.activeIntervalTarget]
      : [];
  const fetching = Boolean(status.syncInProgress || status.currentSync);
  const raceArmed = legacy
    ? Boolean(race && status.oddsSyncEnabled)
    : race
      ? targets.some((t) => sameRace(t, race))
      : false;
  const last = status.lastSync ?? null;
  const lastTime = last?.at
    ? new Date(last.at).toLocaleTimeString("zh-HK", { hour12: false })
    : null;

  return (
    <span className="sync-chips">
      {!status.oddsSyncEnabled ? (
        <span className="sync-chip warn">賠率同步停用</span>
      ) : legacy ? (
        <span className={`sync-chip ${fetching ? "live" : "ok"}`}>
          {fetching && <span className="sync-dot" aria-hidden />}
          全域賠率同步
        </span>
      ) : targets.length ? (
        <span className={`sync-chip ${fetching ? "live" : "ok"}`}>
          {fetching && <span className="sync-dot" aria-hidden />}
          同步中 {targets[0].venue_code} {targets.map((t) => `R${t.race_no}`).join("・")}
        </span>
      ) : councilRunning ? (
        <span className="sync-chip warn">賠率同步啟動中</span>
      ) : (
        <span className="sync-chip">賠率同步待命</span>
      )}
      {race && status.oddsSyncEnabled && !legacy && (
        <span className={`sync-chip ${raceArmed ? "ok" : councilRunning ? "warn" : "idle"}`}>
          {raceArmed
            ? "本場已納入同步"
            : councilRunning
              ? "本場同步啟動中"
              : "本場未同步"}
        </span>
      )}
      {last &&
        (last.error ? (
          <span className="sync-chip warn">上次同步失敗{lastTime ? ` · ${lastTime}` : ""}</span>
        ) : (
          <span className="sync-chip">
            上次成功 {lastTime}
            {typeof last.result?.inserted === "number" ? ` · 新增 ${last.result.inserted} 筆` : ""}
          </span>
        ))}
    </span>
  );
}
