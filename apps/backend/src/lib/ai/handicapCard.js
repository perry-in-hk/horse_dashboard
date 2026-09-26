/**
 * Pre-race card built only from rows dated before the meeting.
 * Missing samples are labeled, never filled with a model percentage.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rate(top, sample) {
  const n = num(sample);
  const t = num(top);
  if (n == null || n <= 0 || t == null) return null;
  return t / n;
}

export async function loadHandicapStats(db, { meetingDate, venueCode, distance, runners }) {
  const codes = (runners ?? []).map((r) => String(r.horse_code ?? "").trim().toUpperCase()).filter(Boolean);
  const byHorse = {};
  for (const runner of runners ?? []) {
    const no = String(runner.no ?? "");
    if (!no) continue;
    byHorse[no] = {
      horse_code: runner.horse_code ?? "",
      jockey: runner.jockey ?? null,
      trainer: runner.trainer ?? null,
      draw: num(runner.draw),
      weight: runner.weight ?? null,
      rating: runner.rating ?? null,
      recent: [],
      cd_sample: 0,
      cd_top3_rate: null,
      jockey_sample: 0,
      jockey_win_rate: null,
      trainer_sample: 0,
      trainer_win_rate: null,
      draw_sample: 0,
      draw_top3_rate: null,
      draw_base_rate: null,
    };
  }
  if (!codes.length || !meetingDate) return byHorse;

  try {
    const recent = await db.query(
      `SELECT horse_code, race_date, venue_track, distance, race_class, going, draw, jockey, position, win_odds
       FROM (
         SELECT horse_code, race_date, venue_track, distance, race_class, going, draw, jockey, position, win_odds,
                row_number() OVER (
                  PARTITION BY horse_code
                  ORDER BY hkjc_parse_history_race_date(race_date) DESC NULLS LAST
                ) AS rn
         FROM hkjc_horse_race_history
         WHERE horse_code = ANY($1::text[])
           AND hkjc_parse_history_race_date(race_date) < $2::date
       ) t
       WHERE rn <= 5`,
      [codes, meetingDate]
    );
    const codeToNo = new Map(
      (runners ?? []).map((r) => [String(r.horse_code ?? "").toUpperCase(), String(r.no ?? "")])
    );
    for (const row of recent.rows) {
      const no = codeToNo.get(String(row.horse_code ?? "").toUpperCase());
      if (!no || !byHorse[no]) continue;
      byHorse[no].recent.push(row);
    }
  } catch {
    // History table may be empty on a fresh volume.
  }

  try {
    const cd = await db.query(
      `SELECT horse_code,
              count(*)::int AS sample,
              count(*) FILTER (
                WHERE NULLIF(substring(position FROM '^[0-9]+'), '')::int <= 3
              )::int AS top3
       FROM hkjc_horse_race_history
       WHERE horse_code = ANY($1::text[])
         AND hkjc_parse_history_race_date(race_date) < $2::date
         AND ($3::int IS NULL OR distance = $3::int)
         AND (
           upper(coalesce(venue_track, '')) LIKE '%' || $4 || '%'
           OR venue_track LIKE CASE WHEN $4 = 'ST' THEN '%沙田%' WHEN $4 = 'HV' THEN '%跑馬地%' ELSE '%' END
         )
       GROUP BY horse_code`,
      [codes, meetingDate, distance ?? null, String(venueCode ?? "").toUpperCase()]
    );
    const codeToNo = new Map(
      (runners ?? []).map((r) => [String(r.horse_code ?? "").toUpperCase(), String(r.no ?? "")])
    );
    for (const row of cd.rows) {
      const no = codeToNo.get(String(row.horse_code ?? "").toUpperCase());
      if (!no || !byHorse[no]) continue;
      byHorse[no].cd_sample = Number(row.sample) || 0;
      byHorse[no].cd_top3_rate = rate(row.top3, row.sample);
    }
  } catch {
    // ignore
  }

  const jockeys = [...new Set((runners ?? []).map((r) => String(r.jockey ?? "").trim()).filter(Boolean))];
  if (jockeys.length) {
    try {
      const jq = await db.query(
        `SELECT jockey,
                count(*)::int AS sample,
                count(*) FILTER (
                  WHERE NULLIF(substring(finish_position FROM '^[0-9]+'), '')::int = 1
                )::int AS wins
         FROM hkjc_race_results
         WHERE race_date < $1::date
           AND race_date >= $1::date - interval '120 days'
           AND jockey = ANY($2::text[])
         GROUP BY jockey`,
        [meetingDate, jockeys]
      );
      const byName = new Map(jq.rows.map((row) => [row.jockey, row]));
      for (const horse of Object.values(byHorse)) {
        const row = byName.get(horse.jockey);
        if (!row) continue;
        horse.jockey_sample = Number(row.sample) || 0;
        horse.jockey_win_rate = rate(row.wins, row.sample);
      }
    } catch {
      // ignore
    }
  }

  const trainers = [...new Set((runners ?? []).map((r) => String(r.trainer ?? "").trim()).filter(Boolean))];
  if (trainers.length) {
    try {
      const tq = await db.query(
        `SELECT trainer,
                count(*)::int AS sample,
                count(*) FILTER (
                  WHERE NULLIF(substring(finish_position FROM '^[0-9]+'), '')::int = 1
                )::int AS wins
         FROM hkjc_race_results
         WHERE race_date < $1::date
           AND race_date >= $1::date - interval '120 days'
           AND trainer = ANY($2::text[])
         GROUP BY trainer`,
        [meetingDate, trainers]
      );
      const byName = new Map(tq.rows.map((row) => [row.trainer, row]));
      for (const horse of Object.values(byHorse)) {
        const row = byName.get(horse.trainer);
        if (!row) continue;
        horse.trainer_sample = Number(row.sample) || 0;
        horse.trainer_win_rate = rate(row.wins, row.sample);
      }
    } catch {
      // ignore
    }
  }

  if (distance) {
    try {
      const dq = await db.query(
        `SELECT CASE
                  WHEN draw IS NULL THEN 'unknown'
                  WHEN draw <= 4 THEN 'inside'
                  WHEN draw <= 8 THEN 'middle'
                  ELSE 'wide'
                END AS bucket,
                count(*)::int AS sample,
                count(*) FILTER (
                  WHERE NULLIF(substring(position FROM '^[0-9]+'), '')::int <= 3
                )::int AS top3
         FROM hkjc_horse_race_history
         WHERE hkjc_parse_history_race_date(race_date) < $1::date
           AND distance = $2::int
           AND (
             upper(coalesce(venue_track, '')) LIKE '%' || $3 || '%'
             OR venue_track LIKE CASE WHEN $3 = 'ST' THEN '%沙田%' WHEN $3 = 'HV' THEN '%跑馬地%' ELSE '%' END
           )
         GROUP BY 1`,
        [meetingDate, distance, String(venueCode ?? "").toUpperCase()]
      );
      const buckets = new Map(dq.rows.map((row) => [row.bucket, row]));
      const baseSample = dq.rows.reduce((acc, row) => acc + Number(row.sample || 0), 0);
      const baseTop = dq.rows.reduce((acc, row) => acc + Number(row.top3 || 0), 0);
      const baseRate = rate(baseTop, baseSample);
      for (const horse of Object.values(byHorse)) {
        const bucket = horse.draw == null ? "unknown" : horse.draw <= 4 ? "inside" : horse.draw <= 8 ? "middle" : "wide";
        const row = buckets.get(bucket);
        horse.draw_sample = Number(row?.sample) || 0;
        horse.draw_top3_rate = rate(row?.top3, row?.sample);
        horse.draw_base_rate = baseRate;
      }
    } catch {
      // ignore
    }
  }

  return byHorse;
}

export function formatHandicapBlock({ raceMeta, runners, stats }) {
  const meta = raceMeta ?? {};
  const header = [
    "今仗資料（缺的欄位不可臆測）",
    `場地 ${meta.venue ?? "缺"} | 途程 ${meta.distance ?? "缺"} | 班次 ${meta.raceClass ?? "缺"} | 場地狀況 ${meta.going ?? "缺"} | 出賽 ${runners?.length ?? 0}`,
  ];
  const lines = [];
  for (const runner of runners ?? []) {
    const no = String(runner.no ?? "");
    const stat = stats?.[no] ?? {};
    const recent = (stat.recent ?? [])
      .slice(0, 5)
      .map((row) => {
        const pos = row.position ?? "-";
        const course = row.venue_track ?? "-";
        const dist = row.distance ?? "-";
        const cls = row.race_class ?? "-";
        const draw = row.draw ?? "-";
        const jk = row.jockey ?? "-";
        const odds = row.win_odds ?? "-";
        return `${row.race_date ?? "-"} ${course} ${dist}m ${cls} 名次${pos} 檔${draw} 騎${jk} 獨贏${odds}`;
      })
      .join(" ; ");
    lines.push(
      [
        `#${no} ${runner.horse_name ?? ""}`,
        `檔位 ${stat.draw ?? "缺"}`,
        `騎師 ${stat.jockey ?? "缺"}`,
        `練馬師 ${stat.trainer ?? "缺"}`,
        `負磅 ${stat.weight ?? "缺"}`,
        `評分 ${stat.rating ?? "缺"}`,
        `近績 ${recent || "缺"}`,
      ].join(" | ")
    );
  }
  return [...header, ...lines].join("\n");
}
