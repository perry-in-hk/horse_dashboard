import { Fragment, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client.ts";
import {
  NO_PREOFF_QUOTE,
  boardPricesFromSnapshots,
  summarizeHorseForm,
  type HorseFormRow,
  type WinQuote,
} from "../lib/aiBoard.js";
import { parsePostTime } from "../lib/racePostTime.ts";

type RaceRef = { no?: string; postTime?: string; status?: string };

type CardRunner = {
  no: number | null;
  horse_name: string;
  horse_code: string;
  draw: number | null;
  is_standby?: boolean;
};

type CardRace = {
  no: number;
  distance: number | null;
  postTime?: string | null;
  runners: CardRunner[];
};

type CardResponse = { races: CardRace[] };

type SnapshotResponse = {
  snapshot: { observed_at: string; payload?: unknown } | null;
};

type AnalyticsRunner = {
  horse_no: number | null;
  horse_name: string | null;
  horse_code: string | null;
  draw: number | null;
};

type CompareResponse = {
  horses: { horse_code: string; horse_name?: string; rows: HorseFormRow[] }[];
};

type BoardRunner = { no: number; name: string; code: string; draw: number | null };

type BoardRace = {
  raceNo: number;
  postTime?: string;
  distance: number | null;
  runners: BoardRunner[];
  loading: boolean;
  error: string | null;
  label: string | null;
  favourite: WinQuote | null;
  second: WinQuote | null;
  observedAt: string | null;
  mode: "before-post" | "latest" | null;
};

type FormSide = { name: string; sameVenueDistance: string; recent: string; draw: string };

type FormState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; favourite: FormSide; second: FormSide };

function raceNumbersOf(races: RaceRef[]): number[] {
  const nums = races
    .map((race) => parseInt(String(race.no ?? ""), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function formatOdds(odds: number): string {
  return String(odds);
}

function formatObserved(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return `${date.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })} (HKT)`;
}

function runnerMap(runners: BoardRunner[]) {
  return new Map(runners.filter((runner) => runner.no > 0).map((runner) => [runner.no, runner]));
}

function HorseQuote({
  quote,
  name,
  missing,
}: {
  quote: WinQuote | null;
  name: string;
  missing: string | null;
}) {
  if (!quote || missing) {
    return <span className="ai-board-missing">{missing ?? NO_PREOFF_QUOTE}</span>;
  }
  return (
    <span className="ai-board-horse">
      <span className="ai-board-no">{quote.horseNo}</span>
      <span className="ai-board-name">{name || "—"}</span>
      <span className="ai-board-odds">{formatOdds(quote.odds)}</span>
    </span>
  );
}

function FormBlock({ title, side }: { title: string; side: FormSide }) {
  return (
    <div className="ai-board-form-card">
      <h4 className="ai-board-form-title">{title}</h4>
      <p className="ai-board-form-name">{side.name}</p>
      <dl className="ai-board-form-dl">
        <div>
          <dt>同場同途程</dt>
          <dd>{side.sameVenueDistance}</dd>
        </div>
        <div>
          <dt>近績</dt>
          <dd>{side.recent}</dd>
        </div>
        <div>
          <dt>檔位</dt>
          <dd>{side.draw}</dd>
        </div>
      </dl>
    </div>
  );
}

const EMPTY_RACES: RaceRef[] = [];

export default function AiRaceBoard({
  meetingDate,
  venueCode,
  races,
  selectedRaceNo,
  onSelectRace,
  dayLabel,
  meetings,
  meetingIdx,
  onMeetingIdx,
  loadingMeetings,
}: {
  meetingDate: string;
  venueCode: string;
  races?: RaceRef[];
  selectedRaceNo: number;
  onSelectRace: (raceNo: number) => void;
  dayLabel: string;
  meetings: { date?: string; venueCode?: string; source?: string }[];
  meetingIdx: number;
  onMeetingIdx: (index: number) => void;
  loadingMeetings: boolean;
}) {
  const raceList = races ?? EMPTY_RACES;
  const raceNos = useMemo(() => raceNumbersOf(raceList), [raceList]);
  const raceKey = raceNos.join(",");
  const [rows, setRows] = useState<BoardRace[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [forms, setForms] = useState<Record<number, FormState>>({});

  useEffect(() => {
    setExpanded(null);
    setForms({});
    if (!meetingDate || !venueCode || !raceNos.length) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const placeholders: BoardRace[] = raceNos.map((raceNo) => {
      const race = raceList.find((item) => parseInt(String(item.no ?? ""), 10) === raceNo);
      return {
        raceNo,
        postTime: race?.postTime,
        distance: null,
        runners: [],
        loading: true,
        error: null,
        label: null,
        favourite: null,
        second: null,
        observedAt: null,
        mode: null,
      };
    });
    setRows(placeholders);

    (async () => {
      let card: CardResponse | null = null;
      try {
        const qs = new URLSearchParams({ meeting_date: meetingDate, venue_code: venueCode });
        card = await apiFetch<CardResponse>(`/api/realtime/racecard-brief?${qs}`);
      } catch {
        card = null;
      }
      const loaded = await Promise.all(
        raceNos.map(async (raceNo): Promise<BoardRace> => {
          const listed = raceList.find((item) => parseInt(String(item.no ?? ""), 10) === raceNo);
          const cardRace = card?.races?.find((item) => item.no === raceNo) ?? null;
          const postTime = listed?.postTime || cardRace?.postTime || undefined;
          const post = parsePostTime(meetingDate, postTime);
          let runners: BoardRunner[] = (cardRace?.runners ?? [])
            .filter((runner) => runner.no != null && runner.no > 0 && !runner.is_standby)
            .map((runner) => ({
              no: runner.no as number,
              name: runner.horse_name,
              code: String(runner.horse_code ?? "").toUpperCase(),
              draw: runner.draw,
            }));
          if (!runners.length) {
            try {
              const history = await apiFetch<AnalyticsRunner[]>(
                `/api/analytics/race/${encodeURIComponent(meetingDate)}/${encodeURIComponent(venueCode)}/${raceNo}/runners`
              );
              runners = (history ?? [])
                .filter((runner) => Number(runner.horse_no) > 0)
                .map((runner) => ({
                  no: Number(runner.horse_no),
                  name: String(runner.horse_name ?? ""),
                  code: String(runner.horse_code ?? "").toUpperCase(),
                  draw: runner.draw != null && Number(runner.draw) > 0 ? Number(runner.draw) : null,
                }));
            } catch {
              runners = [];
            }
          }
          let snapshot: SnapshotResponse["snapshot"] = null;
          let error: string | null = null;
          try {
            const qs = new URLSearchParams({
              meeting_date: meetingDate,
              venue_code: venueCode,
              race_no: String(raceNo),
            });
            if (post) qs.set("before", post.toISOString());
            const body = await apiFetch<SnapshotResponse>(`/api/realtime/preoff-win?${qs}`);
            snapshot = body.snapshot ?? null;
          } catch (e) {
            error = e instanceof Error ? e.message : "讀取報價失敗";
          }
          const prices = boardPricesFromSnapshots(snapshot ? [snapshot] : [], post ? post.getTime() : null);
          return {
            raceNo,
            postTime,
            distance: cardRace?.distance ?? null,
            runners,
            loading: false,
            error,
            label: prices.label,
            favourite: prices.favourite,
            second: prices.second,
            observedAt: prices.observedAt,
            mode: prices.mode,
          };
        })
      );
      if (!cancelled) setRows(loaded);
    })().catch(() => {
      if (!cancelled) {
        setRows((prev) => prev.map((row) => ({ ...row, loading: false, error: "讀取全場表失敗", label: NO_PREOFF_QUOTE })));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [meetingDate, venueCode, raceKey, raceList]);

  const loadForm = (row: BoardRace) => {
    if (!row.favourite || !row.second) return;
    const byNo = runnerMap(row.runners);
    const favRunner = byNo.get(row.favourite.horseNo);
    const secondRunner = byNo.get(row.second.horseNo);
    const codes = [favRunner?.code, secondRunner?.code].filter((code): code is string => Boolean(code));
    if (!codes.length) {
      const missing = (quote: WinQuote, runner: BoardRunner | undefined): FormSide => ({
        name: runner?.name || `${quote.horseNo} 號`,
        sameVenueDistance: "無法計算：沒有馬匹編號，對唔到往績",
        recent: "無法計算：沒有馬匹編號，對唔到往績",
        draw: runner?.draw ? `今場 ${runner.draw} 檔` : "無法計算今場檔位",
      });
      setForms((prev) => ({
        ...prev,
        [row.raceNo]: {
          status: "ready",
          favourite: missing(row.favourite as WinQuote, favRunner),
          second: missing(row.second as WinQuote, secondRunner),
        },
      }));
      return;
    }
    setForms((prev) => ({ ...prev, [row.raceNo]: { status: "loading" } }));
    const qs = new URLSearchParams({ codes: codes.join(",") });
    apiFetch<CompareResponse>(`/api/analytics/horses/compare?${qs}`)
      .then((body) => {
        const horses = body.horses ?? [];
        const side = (quote: WinQuote, runner: BoardRunner | undefined): FormSide => {
          const code = runner?.code ?? "";
          const horse = horses.find((item) => String(item.horse_code ?? "").toUpperCase() === code);
          const summary = summarizeHorseForm(horse?.rows ?? [], {
            venueCode,
            meetingDate,
            raceNo: row.raceNo,
            distance: row.distance,
            draw: runner?.draw ?? null,
          });
          return {
            name: runner?.name || horse?.horse_name || `${quote.horseNo} 號`,
            ...summary,
          };
        };
        setForms((prev) => ({
          ...prev,
          [row.raceNo]: {
            status: "ready",
            favourite: side(row.favourite as WinQuote, favRunner),
            second: side(row.second as WinQuote, secondRunner),
          },
        }));
      })
      .catch((e: Error) => {
        setForms((prev) => ({
          ...prev,
          [row.raceNo]: { status: "error", message: e.message || "往績讀取失敗" },
        }));
      });
  };

  const toggle = (row: BoardRace) => {
    onSelectRace(row.raceNo);
    setExpanded((current) => {
      const next = current === row.raceNo ? null : row.raceNo;
      if (next === row.raceNo && !forms[row.raceNo]) loadForm(row);
      return next;
    });
  };

  return (
    <section className="card ai-board" aria-label="當日全場表">
      <header className="ai-board-head">
        <div>
          <h2 className="ai-board-title">當日全場表</h2>
          <p className="ai-board-day">{dayLabel}</p>
        </div>
        <label className="ai-board-meeting">
          <span className="field-label">賽馬日／場地</span>
          <select
            value={meetingIdx}
            onChange={(e) => onMeetingIdx(Number(e.target.value))}
            disabled={!meetings.length || loadingMeetings}
          >
            {meetings.map((m, i) => (
              <option key={`${m.date}-${m.venueCode}-${i}`} value={i}>
                {String(m.date ?? "").slice(0, 10)} · {m.venueCode}
                {m.source === "history" ? " · 歷史" : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="muted ai-board-note">熱門同次熱用開跑前獨贏報價。撳開一場先見往績同場地，數字唔係議會文字。</p>
      </header>
      {!meetingDate ? (
        <p className="muted">未有可選賽日。</p>
      ) : !raceNos.length ? (
        <p className="muted">呢個賽日未有場次。</p>
      ) : (
        <div className="ai-board-table-wrap">
          <table className="ai-board-table">
            <thead>
              <tr>
                <th>場次</th>
                <th>熱門</th>
                <th>次熱</th>
                <th>報價</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const byNo = runnerMap(row.runners);
                const favName = row.favourite ? byNo.get(row.favourite.horseNo)?.name ?? "" : "";
                const secondName = row.second ? byNo.get(row.second.horseNo)?.name ?? "" : "";
                const open = expanded === row.raceNo;
                const form = forms[row.raceNo];
                return (
                  <Fragment key={row.raceNo}>
                    <tr className={selectedRaceNo === row.raceNo ? "is-selected" : undefined}>
                      <td>
                        <button
                          type="button"
                          className="ai-board-race-btn"
                          aria-expanded={open}
                          onClick={() => toggle(row)}
                        >
                          {open ? "收起" : "撳開"} 第 {row.raceNo} 場
                        </button>
                      </td>
                      <td>
                        {row.loading ? (
                          <span className="muted">載入報價…</span>
                        ) : (
                          <HorseQuote quote={row.favourite} name={favName} missing={row.label} />
                        )}
                      </td>
                      <td>
                        {row.loading ? (
                          <span className="muted">載入報價…</span>
                        ) : (
                          <HorseQuote quote={row.second} name={secondName} missing={row.label} />
                        )}
                      </td>
                      <td className="ai-board-when">
                        {row.loading ? (
                          "—"
                        ) : row.label ? (
                          <span className="ai-board-missing">{row.label}</span>
                        ) : (
                          <>
                            <span>{formatObserved(row.observedAt)}</span>
                            {row.mode === "latest" ? (
                              <span className="ai-board-caveat">未能判斷開跑時間，用最近儲存報價</span>
                            ) : (
                              <span className="ai-board-caveat">開跑前最後報價</span>
                            )}
                          </>
                        )}
                        {row.error ? <span className="ai-board-caveat">{row.error}</span> : null}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="ai-board-form-row">
                        <td colSpan={4}>
                          {row.label || !row.favourite || !row.second ? (
                            <p className="ai-board-missing">{NO_PREOFF_QUOTE}，所以呢場未有熱門同次熱可以對往績。</p>
                          ) : !form || form.status === "loading" || form.status === "idle" ? (
                            <p className="muted">計緊往績…</p>
                          ) : form.status === "error" ? (
                            <p className="ai-board-missing">往績讀取失敗：{form.message}</p>
                          ) : (
                            <div className="ai-board-form-grid">
                              <FormBlock title="熱門" side={form.favourite} />
                              <FormBlock title="次熱" side={form.second} />
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
