import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client.ts";
import {
  NO_MEETING_PICK,
  NOT_MENTIONED,
  followOnLines,
  horseNoteFor,
  listRoundNumbers,
  winSuggestion,
} from "../lib/councilPickDisplay.js";

type RaceRef = { no?: string; postTime?: string; status?: string };
type MeetingRef = { date?: string; venueCode?: string; source?: string };

type PickBlob = {
  others?: { product?: string; combo?: string; reason_zh?: string; reason_en?: string; odds?: string }[];
  qpl?: { combo?: string; reason_zh?: string; reason_en?: string; product?: string; odds?: string }[];
  horse_notes?: { horse_no: number; summary_zh: string; buy_zh: string; stake_zh: string; view?: string }[];
  _status?: { round_no?: number };
};

type MeetingPicksResponse = {
  races: { race_no: number; picks: PickBlob | null }[];
};

type CardRunner = {
  no: number;
  name: string;
  jockey: string;
  draw: string;
};

type LiveMessage = {
  content?: string;
  role?: string;
  meta_json?: Record<string, unknown>;
};

function raceNumbers(races: RaceRef[] | undefined): number[] {
  const nums = (races ?? [])
    .map((race) => parseInt(String(race.no ?? ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function hktToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function venueName(code: string): string {
  if (code === "ST") return "沙田";
  if (code === "HV") return "跑馬地";
  return code || "—";
}

function runnerName(runners: CardRunner[], horseNo: number): string {
  return runners.find((runner) => runner.no === horseNo)?.name || "";
}

export default function AiRaceField({
  meetingDate,
  venueCode,
  races,
  raceNo,
  onSelectRace,
  meetings,
  meetingIdx,
  onMeetingIdx,
  loadingMeetings,
  messages,
  livePicks,
}: {
  meetingDate: string;
  venueCode: string;
  races?: RaceRef[];
  raceNo: number;
  onSelectRace: (raceNo: number) => void;
  meetings: MeetingRef[];
  meetingIdx: number;
  onMeetingIdx: (index: number) => void;
  loadingMeetings: boolean;
  messages: LiveMessage[];
  livePicks: PickBlob | null;
}) {
  const numbers = useMemo(() => raceNumbers(races), [races]);
  const [stored, setStored] = useState<Record<number, PickBlob | null>>({});
  const [picksErr, setPicksErr] = useState<string | null>(null);
  const [runners, setRunners] = useState<CardRunner[]>([]);
  const [runnersNote, setRunnersNote] = useState<string | null>(null);
  const [runnersLoading, setRunnersLoading] = useState(false);
  const [selectedRound, setSelectedRound] = useState(0);

  useEffect(() => {
    if (!meetingDate || !venueCode) {
      setStored({});
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ meeting_date: meetingDate, venue_code: venueCode });
    apiFetch<MeetingPicksResponse>(`/api/council/meeting-picks?${qs}`)
      .then((body) => {
        if (cancelled) return;
        const map: Record<number, PickBlob | null> = {};
        for (const row of body.races ?? []) map[Number(row.race_no)] = row.picks ?? null;
        setStored(map);
        setPicksErr(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setPicksErr(e.message || "讀取建議失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [meetingDate, venueCode]);

  useEffect(() => {
    if (!meetingDate || !venueCode || !raceNo) {
      setRunners([]);
      return;
    }
    let cancelled = false;
    setRunners([]);
    setRunnersNote(null);
    setRunnersLoading(true);
    const qs = new URLSearchParams({
      meeting_date: meetingDate,
      venue_code: venueCode,
      race_no: String(raceNo),
    });
    apiFetch<{ runners?: { no: number | null; horse_name?: string; jockey?: string; draw?: number | null; is_standby?: boolean }[] }>(
      `/api/realtime/race-runners?${qs}`
    )
      .then((body) => {
        const list = (body.runners ?? [])
          .filter((runner) => Number(runner.no) > 0 && !runner.is_standby)
          .map((runner) => ({
            no: Number(runner.no),
            name: String(runner.horse_name ?? "").trim(),
            jockey: String(runner.jockey ?? "").trim(),
            draw: runner.draw != null && Number(runner.draw) > 0 ? String(runner.draw) : "",
          }));
        if (!list.length) throw new Error("empty");
        if (!cancelled) {
          setRunners(list);
          setRunnersLoading(false);
        }
      })
      .catch(() => {
        apiFetch<{ horse_no: number; horse_name?: string; jockey?: string; draw?: number | null }[]>(
          `/api/analytics/race/${encodeURIComponent(meetingDate)}/${encodeURIComponent(venueCode)}/${raceNo}/runners`
        )
          .then((rows) => {
            const list = (rows ?? [])
              .filter((runner) => Number(runner.horse_no) > 0)
              .map((runner) => ({
                no: Number(runner.horse_no),
                name: String(runner.horse_name ?? "").trim(),
                jockey: String(runner.jockey ?? "").trim(),
                draw: runner.draw != null && Number(runner.draw) > 0 ? String(runner.draw) : "",
              }));
            if (!cancelled) {
              setRunners(list);
              setRunnersLoading(false);
              if (!list.length) setRunnersNote("未有排位，未能列出全場馬匹。");
            }
          })
          .catch(() => {
            if (!cancelled) {
              setRunners([]);
              setRunnersLoading(false);
              setRunnersNote("未有排位，未能列出全場馬匹。");
            }
          });
      });
    return () => {
      cancelled = true;
    };
  }, [meetingDate, venueCode, raceNo]);

  const today = hktToday();
  const dayLabel = !meetingDate
    ? "未有可選賽日"
    : meetingDate === today
      ? `賽日 ${meetingDate} · ${venueName(venueCode)}（今日）`
      : `今日沒有選中的賽事，現正顯示 ${meetingDate} · ${venueName(venueCode)}`;

  const rounds = useMemo(() => listRoundNumbers(messages), [messages]);
  const latestRound = rounds.length ? rounds[rounds.length - 1] : 0;
  const followedLatestRef = useRef(0);

  useEffect(() => {
    followedLatestRef.current = 0;
  }, [meetingDate, venueCode, raceNo]);

  useEffect(() => {
    if (!rounds.length) {
      setSelectedRound(0);
      return;
    }
    if (latestRound !== followedLatestRef.current) {
      followedLatestRef.current = latestRound;
      setSelectedRound(latestRound);
      return;
    }
    setSelectedRound((prev) => (rounds.includes(prev) ? prev : latestRound));
  }, [rounds, latestRound]);

  const chooseRound = (roundNo: number) => {
    setSelectedRound(roundNo);
  };

  const picks = raceNo && livePicks ? livePicks : stored[raceNo] ?? null;
  const win = winSuggestion(picks);
  const follow = followOnLines(picks);

  return (
    <section className="card ai-field" aria-label="當日賽事建議">
      <header className="ai-field-head">
        <div>
          <h2 className="ai-field-title">當日賽事</h2>
          <p className="ai-field-day">{dayLabel}</p>
        </div>
        <div className="ai-field-picks">
          <label className="ai-field-meeting">
            <span className="field-label">賽馬日／場地</span>
            <select
              value={meetings.length ? meetingIdx : ""}
              onChange={(e) => onMeetingIdx(Number(e.target.value))}
              disabled={!meetings.length || loadingMeetings}
            >
              {meetings.map((meeting, index) => (
                <option key={`${meeting.date}-${meeting.venueCode}-${index}`} value={index}>
                  {String(meeting.date ?? "").slice(0, 10)} · {meeting.venueCode}
                  {meeting.source === "history" ? " · 歷史" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field-meeting">
            <span className="field-label">場次</span>
            <select
              value={numbers.includes(raceNo) ? raceNo : ""}
              onChange={(e) => onSelectRace(Number(e.target.value))}
              disabled={!numbers.length}
            >
              {numbers.length ? (
                numbers.map((n) => (
                  <option key={n} value={n}>
                    第 {n} 場
                  </option>
                ))
              ) : (
                <option value="">未有場次</option>
              )}
            </select>
          </label>
        </div>
      </header>
      <p className="muted ai-field-note">第一行係首席分析師嘅獨贏建議，唔係熱門對次熱，亦唔保證獲利。未開會就唔會自動開會。</p>
      {picksErr ? <p className="ai-field-empty">{picksErr}</p> : null}
      {!numbers.length ? (
        <p className="muted">呢個賽日未有場次。</p>
      ) : (
        <div className="ai-field-race is-open">
          {win ? (
            <p className="ai-field-win">
              <span className="ai-field-win-tag">WIN</span>
              <span className="ai-field-win-no">#{win.horseNo}</span>
              <span className="ai-field-win-name">{runnerName(runners, win.horseNo)}</span>
              <span className="ai-field-win-reason">{win.reason || "—"}</span>
            </p>
          ) : (
            <p className="ai-field-empty">{NO_MEETING_PICK}</p>
          )}
          {win && follow.length ? (
            <ul className="ai-field-follow">
              {follow.map((line, index) => (
                <li key={`${line.product}-${line.combo}-${index}`}>
                  <span>{line.product}</span> {line.combo}
                  {line.reason ? <span className="muted"> {line.reason}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="ai-field-cards-wrap">
            <label className="ai-field-round">
              <span className="field-label">回合</span>
              <select
                value={rounds.length ? selectedRound : ""}
                disabled={!rounds.length}
                onChange={(e) => chooseRound(Number(e.target.value))}
              >
                {rounds.length ? (
                  rounds.map((round) => (
                    <option key={round} value={round}>
                      第 {round} 輪
                    </option>
                  ))
                ) : (
                  <option value="">未有回合</option>
                )}
              </select>
            </label>
            <div className="ai-field-cards" aria-label={`第 ${raceNo} 場全場`}>
              {runnersLoading ? <p className="muted">載入排位…</p> : null}
              {runnersNote ? <p className="muted">{runnersNote}</p> : null}
              {runners.map((runner) => {
                const note = horseNoteFor(runner.no, {
                  messages,
                  picks: !rounds.length || selectedRound === latestRound ? picks : null,
                  roundNo: rounds.length ? selectedRound : undefined,
                });
                const view = note?.view === "positive" || note?.view === "negative" ? note.view : "none";
                const suggested = win?.horseNo === runner.no;
                return (
                  <article key={runner.no} className={`ai-horse-card ${suggested ? "is-suggestion" : ""}`}>
                    <header>
                      <span className="ai-horse-no">#{runner.no}</span>
                      <strong className={`ai-horse-name is-${view}`}>{runner.name || "—"}</strong>
                      {suggested ? <span className="ai-horse-badge">建議</span> : null}
                    </header>
                    <p className="ai-horse-meta">
                      騎師 {runner.jockey || "—"} · 檔位 {runner.draw || "—"}
                    </p>
                    {note ? (
                      <>
                        <p className="ai-horse-summary">{note.summary_zh}</p>
                        <p className="ai-horse-buy">買：{note.buy_zh}</p>
                        <p className="ai-horse-stake">{note.stake_zh}</p>
                      </>
                    ) : (
                      <p className="ai-horse-silent">{NOT_MENTIONED}</p>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
