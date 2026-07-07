import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../db.js";
import { writeAudit } from "../lib/auditLog.js";

const loginBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export async function login(req, res) {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit(req, {
      eventType: "login_failure",
      success: false,
      detail: { reason: "invalid_request" },
    });
    return res.status(400).json({ error: "Invalid request" });
  }

  const { username, password } = parsed.data;
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    await writeAudit(req, {
      eventType: "login_failure",
      success: false,
      detail: { reason: "blank_username" },
    });
    return res.status(400).json({ error: "Invalid request" });
  }

  const { rows } = await pool.query(
    "SELECT id, username, password_hash, role FROM dashboard_users WHERE username = $1",
    [normalizedUsername]
  );
  if (!rows.length || !rows[0].password_hash) {
    await writeAudit(req, {
      eventType: "login_failure",
      success: false,
      username: normalizedUsername,
      detail: { reason: "invalid_credentials" },
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const row = rows[0];
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    await writeAudit(req, {
      eventType: "login_failure",
      success: false,
      username: normalizedUsername,
      detail: { reason: "invalid_credentials" },
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.regenerate(async (err) => {
    if (err) {
      await writeAudit(req, {
        eventType: "login_failure",
        success: false,
        username: normalizedUsername,
        userId: row.id,
        detail: { reason: "session_regenerate_failed" },
      });
      return res.status(500).json({ error: "Login failed" });
    }
    req.session.userId = row.id;
    await writeAudit(req, {
      eventType: "login_success",
      success: true,
      username: row.username,
      userId: row.id,
    });
    res.json({
      user: { id: row.id, username: row.username, role: row.role },
    });
  });
}

export async function logout(req, res) {
  const auditPayload = {
    eventType: "logout",
    success: true,
    username: req.user?.username,
    userId: req.user?.id,
  };
  req.session.destroy(async (err) => {
    if (err) {
      await writeAudit(req, {
        eventType: "logout",
        success: false,
        username: req.user?.username,
        userId: req.user?.id,
        detail: { reason: "session_destroy_failed" },
      });
      return res.status(500).json({ error: "Logout failed" });
    }
    await writeAudit(req, auditPayload);
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
