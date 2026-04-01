import { readFile } from "node:fs/promises";
import { pool } from "./db.js";

export async function runMigrations() {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
  const dropLegacy = await readFile(
    new URL("./schema_drop_legacy.sql", import.meta.url),
    "utf8"
  );
  await pool.query(dropLegacy);
}
