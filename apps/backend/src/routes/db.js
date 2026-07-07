import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const TABLE_ALLOWLIST = new Set([
  "hkjc_race_results",
  "hkjc_dividends",
  "hkjc_local_race_events",
  "hkjc_horse_details",
  "hkjc_horse_race_history",
  "hkjc_merged_race_data",
  "hkjc_ai_analyses",
  "hkjc_odds_snapshots",
  "dashboard_users",
]);

const ALLOWLIST_NAMES = [...TABLE_ALLOWLIST];

function isAllowedTable(name) {
  return TABLE_ALLOWLIST.has(name);
}

/** Prefer pg stats; fall back to COUNT(*) when stats are still zero after bulk load. */
async function resolveRowEstimate(tableName, estimate) {
  if (estimate > 0) return estimate;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::bigint AS n FROM "${tableName}"`
  );
  return Number(rows[0].n);
}

// ---- List public tables with row counts -------------------------------------

router.get("/tables", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT t.table_name,
            GREATEST(
              COALESCE(st.n_live_tup, 0),
              COALESCE(FLOOR(c.reltuples), 0)::bigint
            ) AS row_estimate
     FROM information_schema.tables t
     JOIN pg_namespace ns ON ns.nspname = t.table_schema
     JOIN pg_class c
       ON c.relname = t.table_name
      AND c.relnamespace = ns.oid
      AND c.relkind IN ('r', 'v', 'm')
     LEFT JOIN pg_stat_user_tables st
       ON st.schemaname = t.table_schema
      AND st.relname = t.table_name
     WHERE t.table_schema = 'public'
       AND t.table_name = ANY($1::text[])
       AND (
         t.table_type = 'BASE TABLE'
         OR (t.table_type = 'VIEW' AND t.table_name = 'hkjc_merged_race_data')
       )
     ORDER BY t.table_name`,
    [ALLOWLIST_NAMES]
  );

  for (const row of rows) {
    row.row_estimate = await resolveRowEstimate(row.table_name, Number(row.row_estimate));
  }

  res.json(rows);
});

// ---- Table column metadata --------------------------------------------------

router.get("/tables/:name/columns", async (req, res) => {
  const { name } = req.params;
  if (!isAllowedTable(name)) {
    return res.status(403).json({ error: "Table not in allowlist" });
  }
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [name]
  );
  res.json(rows);
});

// ---- Preview rows (paginated, read-only) ------------------------------------

router.get("/tables/:name/preview", async (req, res) => {
  const { name } = req.params;
  if (!isAllowedTable(name)) {
    return res.status(403).json({ error: "Table not in allowlist" });
  }

  const limit = Math.min(Number(req.query.limit ?? 100), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  const { rows } = await pool.query(
    `SELECT * FROM "${name}" ORDER BY 1 LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM "${name}"`
  );

  res.json({ rows, total: countResult.rows[0].total, limit, offset });
});

export default router;
