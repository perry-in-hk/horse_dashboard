import { pool } from "../db.js";

function getClientIp(req) {
  const forwardedFor = req.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.ip || null;
}

export async function writeAudit(req, { eventType, success, username = null, userId = null, detail = null }) {
  try {
    await pool.query(
      `INSERT INTO dashboard_audit_log (event_type, success, username, user_id, ip, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        eventType,
        success,
        username,
        userId,
        getClientIp(req),
        req.get("user-agent") || null,
        detail ? JSON.stringify(detail) : null,
      ]
    );
  } catch (e) {
    console.error("Audit log write failed:", e);
  }
}
