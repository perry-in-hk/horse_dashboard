import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client.ts";
import {
  NO_MEETING_PICK,
  NOT_MENTIONED,
  commentsForHorse,
  followOnLines,
  horseNameView,
  listRoundNumbers,
  winSuggestion,
} from "../lib/councilPickDisplay.js";

type RaceRef = { no?: string; postTime?: string; status?: string };
type MeetingRef = { date?: string; venueCode?: string; source?: string };

type PickBlob = {
  others?: { product?: string; combo?: string; reason_zh?: string; reason_en?: string; odds?: string }[];
  qpl?: { combo?: string; reason_zh?: string; reason_en?: string; product?: string; odds?: string }[];
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

function roundStorageKey(meetingDate: string, venueCode: string, raceNo: number): string {
  return `hkjc.aiHorseRound:${meetingDate}:${venueCode}:${raceNo}`;
}

function readChosenRound(meetingDate: string, venueCode: string, raceNo: number): number {
  try {
    const raw = localStorage.getItem(roundStorageKey(meetingDate, venueCode, raceNo));
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { round?: number; chosen?: boolean };
    if (!parsed?.chosen) return 0;
    const n = Number(parsed.round);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeChosenRound(meetingDate: string, venueCode: string, raceNo: number, roundNo: number) {
  try {
    localStorage.setItem(
      roundStorageKey(meetingDate, venueCode, raceNo),
      JSON.stringify({ round: roundNo, chosen: true })
    );
  } catch {
    /* private mode or full storage */
  }
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

  useEffect(() => {
    if (!rounds.length) {
      setSelectedRound(0);
      return;
    }
    const chosen = readChosenRound(meetingDate, venueCode, raceNo);
    setSelectedRound(rounds.includes(chosen) ? chosen : latestRound);
  }, [rounds, latestRound, meetingDate, venueCode, raceNo]);

  const chooseRound = (roundNo: number) => {
    setSelectedRound(roundNo);
    writeChosenRound(meetingDate, venueCode, raceNo, roundNo);
  };

  const picksFor = (n: number): PickBlob | null => {
    if (n === raceNo && livePicks) return livePicks;
    return stored[n] ?? null;
  };

  const anyPick = numbers.some((n) => winSuggestion(picksFor(n)));

  return (
    <section className="card ai-field" aria-label="當日賽事建議">
      <header className="ai-field-head">
        <div>
          <h2 className="ai-field-title">當日賽事</h2>
          <p className="ai-field-day">{dayLabel}</p>
        </div>
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
      </header>
      <p className="muted ai-field-note">第一行係首席分析師嘅獨贏建議，唔係熱門對次熱，亦唔保證獲利。未開會就唔會自動開會。</p>
      {!anyPick && numbers.length > 0 ? <p className="ai-field-empty">{NO_MEETING_PICK}</p> : null}
      {picksErr ? <p className="ai-field-empty">{picksErr}</p> : null}
      {!numbers.length ? (
        <p className="muted">呢個賽日未有場次。</p>
      ) : (
        <div className="ai-field-races">
          {numbers.map((n) => {
            const picks = picksFor(n);
            const win = winSuggestion(picks);
            const follow = followOnLines(picks);
            const open = n === raceNo;
            const fieldRunners = open ? runners : [];
            return (
              <article key={n} className={`ai-field-race ${open ? "is-open" : ""}`}>
                <button type="button" className="ai-field-race-btn" onClick={() => onSelectRace(n)}>
                  第 {n} 場
                </button>
                {win ? (
                  <p className="ai-field-win">
                    <span className="ai-field-win-tag">WIN</span>
                    <span className="ai-field-win-no">#{win.horseNo}</span>
                    <span className="ai-field-win-name">{open ? runnerName(fieldRunners, win.horseNo) : ""}</span>
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
                {open ? (
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
                  <div className="ai-field-cards" aria-label={`第 ${n} 場全場`}>
                    {runnersLoading ? <p className="muted">載入排位…</p> : null}
                    {runnersNote ? <p className="muted">{runnersNote}</p> : null}
                    {fieldRunners.map((runner) => {
                      const quotes = commentsForHorse(runner.no, {
                        messages: open ? messages : [],
                        picks: !rounds.length || selectedRound === latestRound ? picks : null,
                        roundNo: rounds.length ? selectedRound : undefined,
                      });
                      const view = horseNameView(quotes);
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
                          {quotes.length === 0 ? (
                            <p className="ai-horse-silent">{NOT_MENTIONED}</p>
                          ) : (
                            <ul className="ai-horse-quotes">
                              {quotes.map((quote, index) => (
                                <li key={`${quote.kind}-${index}`}>
                                  <span className="ai-horse-quote-src">
                                    {quote.kind === "pick" ? quote.product || "建議" : quote.speaker || "發言"}
                                  </span>
                                  {quote.text}
                                </li>
                              ))}
                            </ul>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
