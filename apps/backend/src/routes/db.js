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
]);

// ---- List public tables with row counts -------------------------------------

router.get("/tables", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT t.table_name,
            COALESCE(pg_stat_get_live_tuples(c.oid)::int, 0) AS row_estimate
     FROM information_schema.tables t
     JOIN pg_class c ON c.relname = t.table_name
     WHERE t.table_schema = 'public'
       AND (
         t.table_type = 'BASE TABLE'
         OR (t.table_type = 'VIEW' AND t.table_name = 'hkjc_merged_race_data')
       )
     ORDER BY t.table_name`
  );
  res.json(rows);
});

// ---- Table column metadata --------------------------------------------------

router.get("/tables/:name/columns", async (req, res) => {
  const { name } = req.params;
  if (!TABLE_ALLOWLIST.has(name)) {
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
  if (!TABLE_ALLOWLIST.has(name)) {
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
