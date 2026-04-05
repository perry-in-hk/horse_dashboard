import { pool } from "../db.js";

export async function requireAuth(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { rows } = await pool.query(
      "SELECT id, username, role FROM dashboard_users WHERE id = $1",
      [userId]
    );
    if (!rows.length) {
      await new Promise((resolve) => req.session.destroy(() => resolve()));
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}
