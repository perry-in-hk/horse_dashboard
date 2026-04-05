import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { apiFetch } from "../api/client.ts";

interface ActiveRace {
  no?: string;
}

interface ActiveMeeting {
  date?: string;
  venueCode?: string;
  races?: ActiveRace[];
}

interface MeetingsResponse {
  meetings: ActiveMeeting[];
}

interface SnapshotCountsResponse {
  counts: { race_no: number; n: number }[];
}

interface RaceAnalysisOverview {
  raceDateLine: string;
  venueLine: string;
  raceNoLine: string;
  fieldSummary: string;
  marketFocus: string;
  situationSummary: string;
}

interface PoolPick {
  combo: string;
  odds?: string;
  reason: string;
}

interface ProPunterStructured {
  introLine?: string;
  win: { main: string; alternate?: string };
  pla: string[];
  qpl: PoolPick[];
  qin: PoolPick[];
}

/** 大注理論章節 — 與後端 bigMoney 物件一致 */
interface BigMoneyStructured {
  summary: string;
  win: string;
  pla: string;
  qpl: string;
  qin: string;
}

/** Mirrors backend raceAnalysisJsonSchema for json_rendered responses. */
interface RaceAnalysisStructured {
  overview: RaceAnalysisOverview;
  qplQinSection: string;
  bigMoney: BigMoneyStructured;
  proPunter: ProPunterStructured;
  riskNotice: string;
}

interface AnalyzeResponse {
  text: string;
  structured?: Record<string, unknown> | null;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  meta?: {
    meeting_date: string;
    venue_code: string;
    race_no: number;
    odds_source: string;
    pair_pools_source?: string;
    qpl_lines?: number;
    qin_lines?: number;
    runners: number;
    output_format?: "json_rendered" | "markdown_legacy";
    /** Set when this run was persisted to SQL or loaded from a saved row. */
    saved_id?: number;
    saved_at?: string;
  };
}

interface SavedAnalysisListItem {
  id: number;
  created_at: string;
  model: string | null;
  output_format: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function isPoolPickRow(x: unknown): x is PoolPick {
  if (!isRecord(x)) return false;
  return typeof x.combo === "string" && typeof x.reason === "string";
}

function isBigMoneyStructured(x: unknown): x is BigMoneyStructured {
  if (!isRecord(x)) return false;
  return ["summary", "win", "pla", "qpl", "qin"].every((k) => typeof x[k] === "string");
}

function isRaceAnalysisStructured(raw: unknown): raw is RaceAnalysisStructured {
  if (!isRecord(raw)) return false;
  const o = raw.overview;
  if (!isRecord(o)) return false;
  const needOv = ["raceDateLine", "venueLine", "raceNoLine", "fieldSummary", "marketFocus", "situationSummary"];
  if (!needOv.every((k) => typeof o[k] === "string")) return false;
  if (typeof raw.qplQinSection !== "string" || typeof raw.riskNotice !== "string") return false;
  if (!isBigMoneyStructured(raw.bigMoney)) return false;
  const p = raw.proPunter;
  if (!isRecord(p)) return false;
  const w = p.win;
  if (!isRecord(w) || typeof w.main !== "string") return false;
  if (!Array.isArray(p.pla) || !p.pla.every((x) => typeof x === "string")) return false;
  const qpl = p.qpl;
  const qin = p.qin;
  if (qpl != null && (!Array.isArray(qpl) || !qpl.every(isPoolPickRow))) return false;
  if (qin != null && (!Array.isArray(qin) || !qin.every(isPoolPickRow))) return false;
  return true;
}

const AI_REC_FOOTNOTE = (
  <>
    根據即時馬匹名單、資料庫近績（合併歷史），以及最新賠率快照中的獨贏／位置與<strong>連贏（QIN）／位置Q（QPL）</strong>
    組合（若有同步）。分析以<strong>繁體中文</strong>輸出，並含「位置Q（QPL）與連贏（QIN）」專節（以位置Q為重點），以及「
    <strong>職業馬迷視角：假設性彩池取向</strong>」與「<strong>大注資金流追蹤（短時間賠率急跌）</strong>」專節——會寫明模擬的
    <strong>獨贏、位置、QPL、QIN</strong>具體馬號／組合（教學示範，非保證）。智能分析需由伺服器啟用 AI 服務。若需 QPL／QIN
    賠率，請於 Realtime 同步包含該等彩池之場次。
  </>
);

function StructuredAnalysisTabs({ data }: { data: RaceAnalysisStructured }) {
  const [tab, setTab] = useState(0);
  const o = data.overview;
  const p = data.proPunter;
  const bm = data.bigMoney;
  const qplRows = Array.isArray(p.qpl) ? p.qpl : [];
  const qinRows = Array.isArray(p.qin) ? p.qin : [];
  const intro =
    p.introLine?.trim() ||
    "以下為模擬職業馬迷，基於現有賠率及有限往績資料，可能考慮的具體投注選項：";

  const tabs = [
    { id: 0, label: "第1部分 · 賽事與彩池" },
    { id: 1, label: "第2部分 · 職業馬迷" },
    { id: 2, label: "第3部分 · 大注資金流" },
  ];

  return (
    <div className="ai-rec-structured">
      <div className="ai-rec-tabs" role="tablist" aria-label="分析章節">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`ai-rec-tab ${tab === t.id ? "ai-rec-tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ai-rec-tab-panel markdown-body" role="tabpanel" hidden={tab !== 0}>
        {tab === 0 && (
          <>
            <h2 className="ai-rec-panel-h2">賽事概覽</h2>
            <div className="ai-rec-overview-lines">
              <p>賽事日期： {o.raceDateLine}</p>
              <p>場地： {o.venueLine}</p>
              <p>賽次： {o.raceNoLine}</p>
              <p>參賽馬匹： {o.fieldSummary}</p>
              <p>市場焦點： {o.marketFocus}</p>
              <p>形勢簡評： {o.situationSummary}</p>
            </div>
            <h2 className="ai-rec-panel-h2">位置Q（QPL）與連贏（QIN）</h2>
            <div className="ai-rec-md">
              <ReactMarkdown>{data.qplQinSection.trim() || "_（無內容）_"}</ReactMarkdown>
            </div>
          </>
        )}
      </div>

      <div className="ai-rec-tab-panel" role="tabpanel" hidden={tab !== 1}>
        {tab === 1 && (
          <div className="ai-rec-pro-card">
            <div className="ai-rec-pro-card-head">職業馬迷視角：假設性彩池取向</div>
            <div className="ai-rec-pro-card-body">
              <p className="ai-rec-pro-intro">{intro}</p>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">獨贏（WIN）</div>
                <pre className="ai-rec-pro-pre">
                  主選：{p.win.main.trim()}
                  {p.win.alternate?.trim() ? `\n備選：${p.win.alternate.trim()}` : ""}
                </pre>
              </div>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">位置（PLA）</div>
                <div className="ai-rec-pro-sub">心水馬匹（按穩健程度排序）：</div>
                <pre className="ai-rec-pro-pre">
                  {p.pla.map((line) => line.trim()).join("\n")}
                </pre>
              </div>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">位置Q（QPL）</div>
                <div className="ai-rec-pro-sub">具體組合與理由：</div>
                {qplRows.length === 0 ? (
                  <pre className="ai-rec-pro-pre">（因快照無此池資料或無法建議具體組合，從略。）</pre>
                ) : (
                  <pre className="ai-rec-pro-pre">
                    {qplRows
                      .map((row) => {
                        const oddsBit = row.odds?.trim() ? `（${row.odds.trim()}）` : "";
                        return `「${row.combo.trim()}」${oddsBit}：${row.reason.trim()}`;
                      })
                      .join("\n")}
                  </pre>
                )}
              </div>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">連贏（QIN）</div>
                <div className="ai-rec-pro-sub">具體組合與理由：</div>
                {qinRows.length === 0 ? (
                  <pre className="ai-rec-pro-pre">（因快照無此池資料或無法建議具體組合，從略。）</pre>
                ) : (
                  <pre className="ai-rec-pro-pre">
                    {qinRows
                      .map((row) => {
                        const oddsBit = row.odds?.trim() ? `（${row.odds.trim()}）` : "";
                        return `「${row.combo.trim()}」${oddsBit}：${row.reason.trim()}`;
                      })
                      .join("\n")}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ai-rec-tab-panel" role="tabpanel" hidden={tab !== 2}>
        {tab === 2 && (
          <div className="ai-rec-pro-card ai-rec-bigmoney-card">
            <div className="ai-rec-pro-card-head">大注資金流追蹤（短時間賠率急跌）</div>
            <div className="ai-rec-pro-card-body">
              <p className="ai-rec-pro-intro">{bm.summary.trim()}</p>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">獨贏（WIN）</div>
                <pre className="ai-rec-pro-pre">{bm.win.trim() || "（無特別說明。）"}</pre>
              </div>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">位置（PLA）</div>
                <pre className="ai-rec-pro-pre">{bm.pla.trim() || "（無特別說明。）"}</pre>
              </div>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">位置Q（QPL）</div>
                <pre className="ai-rec-pro-pre">{bm.qpl.trim() || "（無特別說明。）"}</pre>
              </div>
              <div className="ai-rec-pro-block">
                <div className="ai-rec-pro-label">連贏（QIN）</div>
                <pre className="ai-rec-pro-pre">{bm.qin.trim() || "（無特別說明。）"}</pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="ai-rec-risk">
        <span className="ai-rec-risk-label">風險提示：</span> {data.riskNotice.trim()}
      </p>
    </div>
  );
}

export default function AiRecommendation() {
  const [meetings, setMeetings] = useState<ActiveMeeting[]>([]);
  const [meetingsErr, setMeetingsErr] = useState<string | null>(null);
  const [meetingIdx, setMeetingIdx] = useState(0);
  const [raceNo, setRaceNo] = useState(1);
  const [snapshotCounts, setSnapshotCounts] = useState<Record<number, number>>({});
  const [loadingMeetings, setLoadingMeetings] = useState(true);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  /** Bumps when a new analyze result arrives so tabbed UI resets to part 1. */
  const [analysisNonce, setAnalysisNonce] = useState(0);
  const [savedRows, setSavedRows] = useState<SavedAnalysisListItem[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  const loadMeetings = useCallback(() => {
    setMeetingsErr(null);
    return apiFetch<MeetingsResponse>("/api/realtime/meetings")
      .then((r) => setMeetings(r.meetings ?? []))
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

  useEffect(() => {
    if (!raceNumbers.length) return;
    if (!raceNumbers.includes(raceNo)) setRaceNo(raceNumbers[0]);
  }, [raceNumbers, raceNo]);

  useEffect(() => {
    if (!meetingDate || !venueCode) {
      setSnapshotCounts({});
      return;
    }
    apiFetch<SnapshotCountsResponse>(
      `/api/realtime/snapshot-counts?meeting_date=${encodeURIComponent(meetingDate)}&venue_code=${encodeURIComponent(venueCode)}`
    )
      .then((r) => {
        const map: Record<number, number> = {};
        for (const row of r.counts ?? []) {
          map[row.race_no] = row.n;
        }
        setSnapshotCounts(map);
      })
      .catch(() => setSnapshotCounts({}));
  }, [meetingDate, venueCode]);

  const loadSavedList = useCallback(() => {
    if (!meetingDate || !venueCode || !raceNo) {
      setSavedRows([]);
      return Promise.resolve();
    }
    setLoadingSaved(true);
    return apiFetch<{ items: SavedAnalysisListItem[] }>(
      `/api/ai/saved?meeting_date=${encodeURIComponent(meetingDate)}&venue_code=${encodeURIComponent(venueCode)}&race_no=${raceNo}`
    )
      .then((r) => setSavedRows(r.items ?? []))
      .catch(() => setSavedRows([]))
      .finally(() => setLoadingSaved(false));
  }, [meetingDate, venueCode, raceNo]);

  useEffect(() => {
    loadSavedList();
  }, [loadSavedList]);

  useEffect(() => {
    setAnalysis(null);
    setAnalysisErr(null);
  }, [meetingDate, venueCode, raceNo]);

  const runAnalyze = () => {
    if (!meetingDate || !venueCode || !raceNo) return;
    setAnalyzing(true);
    setAnalysisErr(null);
    setAnalysis(null);
    apiFetch<AnalyzeResponse>("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meeting_date: meetingDate,
        venue_code: venueCode,
        race_no: raceNo,
      }),
    })
      .then((r) => {
        setAnalysis(r);
        setAnalysisNonce((n) => n + 1);
        loadSavedList();
      })
      .catch((e: Error) => setAnalysisErr(e.message))
      .finally(() => setAnalyzing(false));
  };

  const loadSavedById = (id: number) => {
    if (!Number.isFinite(id) || id < 1) return;
    setAnalysisErr(null);
    apiFetch<AnalyzeResponse>(`/api/ai/saved/${id}`)
      .then((r) => {
        setAnalysis(r);
        setAnalysisNonce((n) => n + 1);
      })
      .catch((e: Error) => setAnalysisErr(e.message));
  };

  const snapN = snapshotCounts[raceNo] ?? 0;

  const structuredData =
    analysis?.meta?.output_format === "json_rendered" && analysis.structured && isRaceAnalysisStructured(analysis.structured)
      ? analysis.structured
      : null;

  return (
    <div className="ai-rec-page">
      <h2 className="card-title" style={{ marginTop: 0 }}>
        智能分析（AI）
      </h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="controls" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div>
            <label className="field-label">賽馬日／場地</label>
            <select
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
          <div>
            <label className="field-label">場次</label>
            <select
              value={raceNo}
              onChange={(e) => setRaceNo(Number(e.target.value))}
              disabled={!raceNumbers.length}
            >
              {raceNumbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn-primary" onClick={() => runAnalyze()} disabled={analyzing || !meetingDate}>
            {analyzing ? "分析中…" : "產生分析"}
          </button>
        </div>
        {meetingDate && venueCode && raceNumbers.length > 0 && (
          <div className="ai-rec-saved-row" style={{ marginTop: 14 }}>
            <label className="field-label" htmlFor="ai-saved-select">
              已儲存分析（資料庫）
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <select
                id="ai-saved-select"
                value={analysis?.meta?.saved_id != null ? String(analysis.meta.saved_id) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  loadSavedById(Number(v));
                }}
                disabled={loadingSaved || savedRows.length === 0}
              >
                <option value="">
                  {savedRows.length === 0
                    ? "（此場次尚無儲存記錄 — 產生分析後會自動寫入）"
                    : "── 選取過往儲存以檢視 ──"}
                </option>
                {savedRows.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    #{row.id} ·{" "}
                    {new Date(row.created_at).toLocaleString("zh-HK", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}{" "}
                    · {row.output_format === "json_rendered" ? "固定版面" : "Markdown"}
                    {row.model ? ` · ${row.model}` : ""}
                  </option>
                ))}
              </select>
              {loadingSaved && <span className="muted" style={{ fontSize: 13 }}>載入清單中…</span>}
            </div>
          </div>
        )}
        {meetingsErr && <p className="muted" style={{ marginTop: 12, color: "#f87171" }}>{meetingsErr}</p>}
        {meetingDate && venueCode && (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
            本場已儲存之賠率快照列數：{" "}
            {snapN > 0 ? (
              <>
                第 {raceNo} 場共 <strong>{snapN}</strong> 筆
              </>
            ) : (
              <>第 {raceNo} 場尚無（分析將盡量使用馬匹顯示的獨贏賠率）</>
            )}
            。需要完整彩池（含 QPL／QIN）請於 Realtime 頁同步。
          </p>
        )}
      </div>

      {analysisErr && (
        <div className="card ai-rec-error" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0, color: "#f87171" }}>{analysisErr}</p>
        </div>
      )}

      {analysis && (
        <section className="card ai-rec-output-wrap">
          {analysis.meta && (
            <p className="muted ai-rec-meta" style={{ marginTop: 0 }}>
              {analysis.meta.meeting_date} · {analysis.meta.venue_code} · 第{analysis.meta.race_no}場 · 獨贏/位置來源：{" "}
              {analysis.meta.odds_source}
              {analysis.meta.output_format && (
                <>
                  {" "}
                  · 格式 {analysis.meta.output_format === "json_rendered" ? "固定版面（JSON）" : "純 Markdown"}
                </>
              )}
              {analysis.meta.pair_pools_source === "snapshot" &&
                analysis.meta.qpl_lines != null &&
                analysis.meta.qin_lines != null && (
                  <>
                    {" "}
                    · QPL 列 {analysis.meta.qpl_lines}／QIN 列 {analysis.meta.qin_lines}（送入模型之截斷列）
                  </>
                )}
              {" "}
              · 馬匹數 {analysis.meta.runners}
              {analysis.model && (
                <>
                  {" "}
                  · 模型 {analysis.model}
                </>
              )}
              {analysis.usage?.total_tokens != null && (
                <>
                  {" "}
                  · 約 {analysis.usage.total_tokens} tokens
                </>
              )}
              {analysis.meta?.saved_id != null && (
                <>
                  {" "}
                  · 已儲存 #{analysis.meta.saved_id}
                  {analysis.meta.saved_at && (
                    <>
                      {" "}
                      （{new Date(analysis.meta.saved_at).toLocaleString("zh-HK", { dateStyle: "short", timeStyle: "short" })}）
                    </>
                  )}
                </>
              )}
            </p>
          )}
          {structuredData ? (
            <StructuredAnalysisTabs key={analysisNonce} data={structuredData} />
          ) : (
            <article className="ai-rec-output markdown-body">
              <ReactMarkdown>{analysis.text || "_No text returned._"}</ReactMarkdown>
            </article>
          )}
        </section>
      )}

      <footer className="ai-rec-footnote muted">{AI_REC_FOOTNOTE}</footer>
    </div>
  );
}
