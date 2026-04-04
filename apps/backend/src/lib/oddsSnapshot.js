import crypto from "node:crypto";

/**
 * Clone value so it round-trips through JSON and is safe for PostgreSQL jsonb.
 * GraphQL responses may include BigInt, which breaks JSON.stringify/pg serialization.
 * @param {unknown} obj
 * @returns {unknown}
 */
export function sanitizePayloadForDb(obj) {
  try {
    return JSON.parse(
      JSON.stringify(obj, (_key, value) => {
        if (typeof value === "bigint") return Number(value);
        if (value === undefined) return null;
        return value;
      })
    );
  } catch {
    return { _serializationError: true, _fallback: String(obj) };
  }
}

/**
 * Stable JSON for hashing (sorted keys).
 * @param {unknown} obj
 * @returns {unknown}
 */
function sortKeys(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const out = {};
  for (const k of Object.keys(/** @type {Record<string, unknown>} */ (obj)).sort()) {
    out[k] = sortKeys(/** @type {Record<string, unknown>} */ (obj)[k]);
  }
  return out;
}

export function canonicalJson(obj) {
  return JSON.stringify(sortKeys(obj));
}

export function hashPayload(obj) {
  return crypto.createHash("sha256").update(canonicalJson(obj)).digest("hex");
}

/**
 * @param {import("pg").Pool} pool
 * @param {{ meetingDate: string; venueCode: string; raceNo: number; oddsTypes: string[]; payload: unknown }} row
 * @returns {Promise<{ inserted: boolean; id?: number }>}
 */
export async function insertSnapshotIfChanged(pool, row) {
  const { meetingDate, venueCode, raceNo, oddsTypes, payload: rawPayload } = row;
  const payload = sanitizePayloadForDb(rawPayload);
  const hash = hashPayload(payload);

  const prev = await pool.query(
    `SELECT payload_hash FROM hkjc_odds_snapshots
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3 AND odds_types = $4::text[]
     ORDER BY observed_at DESC
     LIMIT 1`,
    [meetingDate, venueCode, raceNo, oddsTypes]
  );

  if (prev.rows[0]?.payload_hash === hash) {
    return { inserted: false };
  }

  const ins = await pool.query(
    `INSERT INTO hkjc_odds_snapshots
       (meeting_date, venue_code, race_no, odds_types, payload_hash, payload)
     VALUES ($1::date, $2, $3, $4::text[], $5, $6::jsonb)
     RETURNING id`,
    [meetingDate, venueCode, raceNo, oddsTypes, hash, JSON.stringify(payload)]
  );

  return { inserted: true, id: ins.rows[0]?.id };
}
