/**
 * Settle a council slip against official finish positions and dividends.
 * Finish position "10" is tenth, not first: the whole leading integer is used.
 */

const PRODUCT_POOLS = {
  WIN: ["WIN", "獨贏"],
  PLA: ["PLA", "位置"],
  QIN: ["QIN", "連贏"],
  QPL: ["QPL", "位置Q", "位置Ｑ"],
  FCT: ["FCT", "二重彩"],
  TCE: ["TCE", "三重彩"],
  TRI: ["TRI", "單T", "單Ｔ"],
  FF: ["FF", "四連環"],
  QTT: ["QTT", "四重彩"],
  DBL: ["DBL", "孖寶"],
};

const ORDERED = new Set(["FCT", "TCE", "QTT"]);

export function parseFinishPosition(raw) {
  const text = String(raw ?? "").trim();
  const m = text.match(/^(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function comboLegs(combo) {
  return String(combo ?? "")
    .match(/\d+/g)
    ?.map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n > 0) ?? [];
}

function placeSlots(finisherCount) {
  if (!Number.isFinite(finisherCount) || finisherCount < 4) return 0;
  return finisherCount >= 7 ? 3 : 2;
}

/**
 * @param {{ product: string, combo: string, positions: Map<number, number>, finisherCount: number }} p
 * @returns {"hit"|"miss"|"no_result"|"skip"}
 */
export function judgePick(p) {
  const product = String(p.product ?? "").toUpperCase();
  const legs = comboLegs(p.combo);
  const positions = p.positions instanceof Map ? p.positions : new Map();
  const finishers = Number(p.finisherCount ?? 0);
  if (!legs.length || finishers <= 0) return "no_result";
  if (product === "DBL") return "skip";
  const placed = legs.map((no) => positions.get(no) ?? null);
  if (placed.some((pos) => pos == null)) return "no_result";

  const slots = placeSlots(finishers);
  if (product === "WIN") return placed[0] === 1 ? "hit" : "miss";
  if (product === "PLA") {
    if (slots <= 0) return "no_result";
    return placed[0] <= slots ? "hit" : "miss";
  }
  if (product === "QIN") {
    if (legs.length !== 2) return "no_result";
    const set = new Set(placed);
    return set.size === 2 && [...set].every((pos) => pos === 1 || pos === 2) ? "hit" : "miss";
  }
  if (product === "QPL") {
    if (legs.length !== 2 || slots < 3) return slots < 3 ? "no_result" : "miss";
    return placed.every((pos) => pos <= 3) ? "hit" : "miss";
  }
  if (product === "FCT") return placed[0] === 1 && placed[1] === 2 ? "hit" : "miss";
  if (product === "TCE") return placed[0] === 1 && placed[1] === 2 && placed[2] === 3 ? "hit" : "miss";
  if (product === "TRI") {
    if (legs.length !== 3) return "no_result";
    const set = new Set(placed);
    return set.size === 3 && [...set].every((pos) => pos <= 3) ? "hit" : "miss";
  }
  if (product === "FF") {
    if (legs.length !== 4) return "no_result";
    return placed.every((pos) => pos <= 4) ? "hit" : "miss";
  }
  if (product === "QTT") {
    return placed.length === 4 && placed[0] === 1 && placed[1] === 2 && placed[2] === 3 && placed[3] === 4
      ? "hit"
      : "miss";
  }
  return "skip";
}

function comboKey(product, combo) {
  const legs = comboLegs(combo);
  if (!legs.length) return "";
  if (ORDERED.has(product)) return legs.join("-");
  return [...legs].sort((a, b) => a - b).join("-");
}

function dividendKey(pool, combination) {
  const product = Object.entries(PRODUCT_POOLS).find(([, names]) =>
    names.some((n) => n.toUpperCase() === String(pool ?? "").trim().toUpperCase())
  )?.[0];
  if (!product) return null;
  return `${product}|${comboKey(product, combination)}`;
}

export function findPayout(dividends, product, combo) {
  const want = `${String(product).toUpperCase()}|${comboKey(product, combo)}`;
  for (const row of dividends ?? []) {
    const key = dividendKey(row.pool, row.combination);
    if (key === want && row.payout_hkd != null && Number.isFinite(Number(row.payout_hkd))) {
      return Number(row.payout_hkd);
    }
  }
  return null;
}

export function unitReturn(outcome, payoutHkd) {
  if (outcome === "miss") return -1;
  if (outcome !== "hit" || payoutHkd == null) return null;
  return Math.round((Number(payoutHkd) / 10 - 1) * 10000) / 10000;
}

function flattenPicks(picks) {
  const lines = [];
  const qpl = Array.isArray(picks?.qpl) ? picks.qpl : [];
  const others = Array.isArray(picks?.others) ? picks.others : [];
  for (const row of qpl) {
    lines.push({
      product: "QPL",
      combo: String(row?.combo ?? ""),
      odds: String(row?.odds ?? ""),
      suggestion: Boolean(row?.suggestion),
    });
  }
  for (const row of others) {
    lines.push({
      product: String(row?.product ?? "WIN").toUpperCase(),
      combo: String(row?.combo ?? ""),
      odds: String(row?.odds ?? ""),
      suggestion: Boolean(row?.suggestion),
    });
  }
  return lines.filter((row) => row.combo.trim());
}

export function scoreSlip({ picks, results, dividends }) {
  const positions = new Map();
  let finishers = 0;
  for (const row of results ?? []) {
    const no = Number.parseInt(String(row.horse_no ?? ""), 10);
    const pos = parseFinishPosition(row.finish_position);
    if (!Number.isFinite(no) || no <= 0 || pos == null) continue;
    positions.set(no, pos);
    finishers += 1;
  }
  const confidence = Number(picks?.confidence);
  const lines = flattenPicks(picks);
  return lines.map((line, index) => {
    const outcome = judgePick({
      product: line.product,
      combo: line.combo,
      positions,
      finisherCount: finishers,
    });
    const payout = outcome === "hit" ? findPayout(dividends, line.product, line.combo) : null;
    const legs = comboLegs(line.combo);
    const closing = legs
      .map((no) => {
        const row = (results ?? []).find((r) => Number(r.horse_no) === no);
        return row?.win_odds != null ? `${no}@${row.win_odds}` : null;
      })
      .filter(Boolean)
      .join(",");
    return {
      line_no: index + 1,
      product: line.product,
      combo: line.combo,
      odds_at_pick: line.odds,
      closing_odds: closing,
      suggestion: Boolean(line.suggestion),
      outcome,
      payout_hkd: payout,
      unit_return: unitReturn(outcome, payout),
      confidence: Number.isFinite(confidence) ? confidence : null,
      finishers,
    };
  });
}

function summarizeGroup(list) {
  const decided = list.filter((r) => r.outcome === "hit" || r.outcome === "miss");
  const hits = decided.filter((r) => r.outcome === "hit").length;
  const byProduct = {};
  for (const row of list) {
    const key = row.product || "?";
    if (!byProduct[key]) byProduct[key] = { hit: 0, miss: 0, no_result: 0, skip: 0 };
    if (byProduct[key][row.outcome] != null) byProduct[key][row.outcome] += 1;
  }
  const returns = decided.map((r) => Number(r.unit_return)).filter((n) => Number.isFinite(n));
  const confHit = list.filter((r) => r.outcome === "hit" && r.confidence != null).map((r) => Number(r.confidence));
  const confMiss = list.filter((r) => r.outcome === "miss" && r.confidence != null).map((r) => Number(r.confidence));
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1000) / 1000 : null);
  return {
    lines: list.length,
    hits,
    misses: decided.length - hits,
    hit_pct: decided.length ? Math.round((1000 * hits) / decided.length) / 10 : null,
    unit_return_sum: returns.length ? Math.round(returns.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
    avg_confidence_hit: avg(confHit),
    avg_confidence_miss: avg(confMiss),
    by_product: byProduct,
  };
}

export function summarizeSettlements(rows) {
  const list = rows ?? [];
  const released = summarizeGroup(list.filter((row) => !row.suggestion));
  return { ...released, suggestion: summarizeGroup(list.filter((row) => row.suggestion)) };
}

export async function settleSession(db, sessionId) {
  const sessionQ = await db.query(
    `SELECT id, meeting_date::text AS meeting_date, upper(venue_code) AS venue_code, race_no
     FROM hkjc_council_sessions WHERE id = $1`,
    [sessionId]
  );
  const session = sessionQ.rows[0];
  if (!session) return null;

  const picksQ = await db.query(
    `SELECT version, picks_json
     FROM hkjc_council_picks
     WHERE session_id = $1
     ORDER BY CASE WHEN (picks_json->'_status'->>'is_final') = 'true' THEN 0 ELSE 1 END, version DESC
     LIMIT 1`,
    [sessionId]
  );
  const pickRow = picksQ.rows[0];
  if (!pickRow) return null;

  const resultsQ = await db.query(
    `SELECT horse_no, finish_position, win_odds
     FROM hkjc_race_results
     WHERE race_date = $1::date AND upper(racecourse) = $2 AND race_no = $3`,
    [session.meeting_date, session.venue_code, session.race_no]
  );
  if (!resultsQ.rows.some((r) => parseFinishPosition(r.finish_position) != null)) {
    return { session_id: sessionId, pending: true, lines: [] };
  }
  const divQ = await db.query(
    `SELECT pool, combination, payout_hkd
     FROM hkjc_dividends
     WHERE race_date = $1::date AND upper(racecourse) = $2 AND race_no = $3`,
    [session.meeting_date, session.venue_code, session.race_no]
  );
  const lines = scoreSlip({
    picks: pickRow.picks_json,
    results: resultsQ.rows,
    dividends: divQ.rows,
  });
  await db.query(`DELETE FROM hkjc_council_settlements WHERE session_id = $1 AND picks_version = $2`, [
    sessionId,
    pickRow.version,
  ]);
  for (const line of lines) {
    await db.query(
      `INSERT INTO hkjc_council_settlements (
         session_id, picks_version, line_no, product, combo, odds_at_pick, closing_odds,
         outcome, payout_hkd, unit_return, confidence, finishers, suggestion
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        sessionId,
        pickRow.version,
        line.line_no,
        line.product,
        line.combo,
        line.odds_at_pick,
        line.closing_odds,
        line.outcome,
        line.payout_hkd,
        line.unit_return,
        line.confidence,
        line.finishers,
        Boolean(line.suggestion),
      ]
    );
  }
  return {
    session_id: Number(sessionId),
    meeting_date: session.meeting_date,
    venue_code: session.venue_code,
    race_no: session.race_no,
    picks_version: pickRow.version,
    confidence: pickRow.picks_json?.confidence ?? null,
    pending: false,
    lines,
    summary: summarizeSettlements(lines),
  };
}

export async function loadScorecard(db, { meetingDate = null, venueCode = null, raceNo = null, limit = 20 } = {}) {
  const params = [];
  const where = ["s.status = 'stopped'"];
  if (meetingDate) {
    params.push(meetingDate);
    where.push(`s.meeting_date = $${params.length}::date`);
  }
  if (venueCode) {
    params.push(String(venueCode).toUpperCase());
    where.push(`upper(s.venue_code) = $${params.length}`);
  }
  if (raceNo) {
    params.push(raceNo);
    where.push(`s.race_no = $${params.length}`);
  }
  params.push(Math.min(50, Math.max(1, Number(limit) || 20)));
  const { rows: sessions } = await db.query(
    `SELECT s.id
     FROM hkjc_council_sessions s
     WHERE ${where.join(" AND ")}
     ORDER BY s.meeting_date DESC, s.race_no ASC, s.id DESC
     LIMIT $${params.length}`,
    params
  );
  const settled = [];
  for (const row of sessions) {
    const one = await settleSession(db, row.id);
    if (one && !one.pending) settled.push(one);
  }
  const flat = settled.flatMap((s) =>
    s.lines.map((line) => ({
      ...line,
      session_id: s.session_id,
      meeting_date: s.meeting_date,
      venue_code: s.venue_code,
      race_no: s.race_no,
      confidence: line.confidence ?? s.confidence,
    }))
  );
  return { races: settled, totals: summarizeSettlements(flat) };
}
