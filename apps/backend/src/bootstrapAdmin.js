import bcrypt from "bcrypt";
import { pool } from "./db.js";

export async function bootstrapInitialAdmin() {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM dashboard_users"
  );
  if (rows[0].c > 0) return;

  const username = process.env.AUTH_INITIAL_USERNAME?.trim();
  const password = process.env.AUTH_INITIAL_PASSWORD;
  if (!username || !password) {
    console.error(
      "FATAL: dashboard_users is empty. Set AUTH_INITIAL_USERNAME and AUTH_INITIAL_PASSWORD in .env, then restart."
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO dashboard_users (username, password_hash, role) VALUES ($1, $2, 'admin')`,
    [username, passwordHash]
  );
  console.log("Bootstrap: created initial admin user (username from AUTH_INITIAL_USERNAME).");
}
