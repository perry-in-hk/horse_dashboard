import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../db.js";

const loginBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export async function login(req, res) {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const { username, password } = parsed.data;

  const { rows } = await pool.query(
    "SELECT id, username, password_hash, role FROM dashboard_users WHERE username = $1",
    [username]
  );
  if (!rows.length) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const row = rows[0];
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: "Login failed" });
    }
    req.session.userId = row.id;
    res.json({
      user: { id: row.id, username: row.username, role: row.role },
    });
  });
}

export function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ ok: true });
  });
}

export function me(req, res) {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
    },
  });
}
