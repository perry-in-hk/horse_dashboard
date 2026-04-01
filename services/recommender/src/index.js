import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

await pool.query("SELECT 1");
console.log(
  "Recommender service idle (legacy recommendations table removed; use Analysis for HKJC data)."
);
await pool.end();

setInterval(() => {}, 3600000);
