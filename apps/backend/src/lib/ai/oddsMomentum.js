/**
 * Short-window odds "momentum": compare consecutive snapshot payloads to find
 * large implied-money drops (odds falling) near request time.
 */

const TOP_N = 8;

function normalizePoolsPayload(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

function parseOddsNum(v) {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** @returns {{ win: Record<string, number>, pla: Record<string, number>, qin: Record<string, number>, qpl: Record<string, number> }} */
function mapsFromPayload(payload) {
  const pools = normalizePoolsPayload(payload);
  const win = {};
  const pla = {};
  const qin = {};
  const qpl = {};
  for (const p of pools) {
    const t = String(p.oddsType ?? "").toUpperCase();
    let target;
    if (t === "WIN") target = win;
    else if (t === "PLA") target = pla;
    else if (t === "QIN") target = qin;
    else if (t === "QPL") target = qpl;
    else continue;
    for (const n of p.oddsNodes ?? []) {
      const comb = String(n.combString ?? "").trim();
      const val = parseOddsNum(n.oddsValue);
      if (!comb || val == null) continue;
      target[comb] = val;
    }
  }
  return { win, pla, qin, qpl };
}

function envNum(key, fallback) {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {import("pg").Pool} pool
 * @param {{ meeting_date: string, venue_code: string, race_no: number }} key
 * @returns {Promise<string>}
 */
export async function buildOddsMomentumPromptBlock(pool, key) {
  const windowMin = envNum("AI_MOMENTUM_WINDOW_MINUTES", 60);
  const maxRows = Math.min(200, Math.max(5, Math.floor(envNum("AI_MOMENTUM_MAX_SNAPSHOTS", 40))));
  const minPct = envNum("AI_MOMENTUM_DROP_PCT_MIN", 12);
  const absMin = envNum("AI_MOMENTUM_ABS_DROP_MIN", 0.35);

  const { rows } = await pool.query(
    `SELECT observed_at, payload
     FROM (
       SELECT observed_at, payload
       FROM hkjc_odds_snapshots
       WHERE meeting_date = $1::date
         AND venue_code = $2
         AND race_no = $3
         AND observed_at >= NOW() - ($4::int * interval '1 minute')
       ORDER BY observed_at DESC
       LIMIT $5
     ) AS recent
     ORDER BY observed_at ASC`,
    [key.meeting_date, key.venue_code, key.race_no, String(windowMin), maxRows]
  );

  if (rows.length < 2) {
    return (
      "### Odds momentum (server-computed, 短時間賠率變化)\n" +
      `_資料不足：此場在過去約 ${windowMin} 分鐘內少於 2 筆快照，無法計算相鄰時間點之賠率跌幅。請在 Realtime 提高同步頻率或確認已有儲存快照。_\n`
    );
  }

  const times = rows.map((r) => new Date(r.observed_at).getTime());
  const spacingMs = [];
  for (let i = 1; i < times.length; i++) {
    spacingMs.push(times[i] - times[i - 1]);
  }
  const medianSpacing =
    spacingMs.length === 0
      ? null
      : [...spacingMs].sort((a, b) => a - b)[Math.floor(spacingMs.length / 2)];

  /** @type {Map<string, { pool: string, key: string, prevOdds: number, nextOdds: number, dropPct: number, dropAbs: number, t0: string, t1: string }>} */
  const bestById = new Map();

  for (let i = 0; i < rows.length - 1; i++) {
    const older = mapsFromPayload(rows[i].payload);
    const newer = mapsFromPayload(rows[i + 1].payload);
    const t0 = new Date(rows[i].observed_at).toISOString();
    const t1 = new Date(rows[i + 1].observed_at).toISOString();

    for (const poolName of ["win", "pla", "qin", "qpl"]) {
      const A = older[poolName];
      const B = newer[poolName];
      const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
      for (const k of keys) {
        const a = A[k];
        const b = B[k];
        if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (a <= 0 || b >= a) continue;
        const dropAbs = a - b;
        const dropPct = (dropAbs / a) * 100;
        const id = `${poolName}:${k}`;
        const cur = bestById.get(id);
        if (!cur || dropPct > cur.dropPct) {
          bestById.set(id, {
            pool: poolName,
            key: k,
            prevOdds: a,
            nextOdds: b,
            dropPct,
            dropAbs,
            t0,
            t1,
          });
        }
      }
    }
  }

  const flagged = [...bestById.values()].filter(
    (x) => x.dropPct >= minPct || x.dropAbs >= absMin
  );
  flagged.sort((a, b) => b.dropPct - a.dropPct);

  const byPool = { win: [], pla: [], qin: [], qpl: [] };
  for (const x of flagged) {
    byPool[x.pool].push(x);
  }
  for (const p of Object.keys(byPool)) {
    byPool[p].sort((a, b) => b.dropPct - a.dropPct);
    byPool[p] = byPool[p].slice(0, TOP_N);
  }

  const tFirst = new Date(rows[0].observed_at).toISOString();
  const tLast = new Date(rows[rows.length - 1].observed_at).toISOString();
  const spacingHint =
    medianSpacing != null
      ? `Median interval between consecutive snapshots in this window: ~${Math.round(medianSpacing / 1000)}s.`
      : "Could not compute snapshot spacing.";

  const lines = [
    "### Odds momentum (server-computed, 短時間賠率急跌偵測)",
    `Window: last ~${windowMin} minutes, up to ${maxRows} newest snapshots, compared oldest→newest in time.`,
    `Snapshot time range: ${tFirst} → ${tLast} (${rows.length} rows).`,
    spacingHint,
    `Rule: for each selection (WIN=horse no, PLA=horse no, QIN/QPL=comb), take the **largest % drop** across any adjacent snapshot pair in the window.`,
    `Flag if dropPct >= ${minPct}% OR dropAbs >= ${absMin} (same selection must show odds falling).`,
    "",
    "Notable drops (candidates for “大注” interpretation — not proof):",
  ];

  function pushPool(label, arr) {
    lines.push(`${label}:`);
    if (arr.length === 0) {
      lines.push(`  - (none above threshold in this window)`);
    } else {
      for (const x of arr) {
        lines.push(
          `  - key ${x.key}: ${x.prevOdds.toFixed(2)} → ${x.nextOdds.toFixed(2)} (−${x.dropPct.toFixed(1)}%, abs −${x.dropAbs.toFixed(2)}) between ${x.t0} and ${x.t1}`
        );
      }
    }
  }

  pushPool("WIN", byPool.win);
  pushPool("PLA", byPool.pla);
  pushPool("QPL", byPool.qpl);
  pushPool("QIN", byPool.qin);

  lines.push("");
  lines.push(
    "Use this block only for the JSON object `bigMoney` (summary, win, pla, qpl, qin strings) in Traditional Chinese: explain whether meaningful short-window drops exist, and give theory-based suggestions per pool separately from other sections."
  );

  return `${lines.join("\n")}\n`;
}
