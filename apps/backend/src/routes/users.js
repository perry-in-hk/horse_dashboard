import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { writeAudit } from "../lib/auditLog.js";

const router = Router();
router.use(requireAdmin);

const createBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(8).max(256),
  role: z.enum(["user", "admin"]).optional(),
});

router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, username, role, created_at FROM dashboard_users ORDER BY id ASC");
    res.json({ users: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      await writeAudit(req, {
        eventType: "admin_create_user",
        success: false,
        userId: req.user?.id,
        username: req.user?.username,
        detail: { reason: "invalid_request" },
      });
      return res.status(400).json({ error: "Invalid request (username, password min 8 chars, optional role)" });
    }

    const { username, password, role = "user" } = parsed.data;
    const trimmedUsername = username.trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO dashboard_users (username, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role, created_at`,
      [trimmedUsername, passwordHash, role]
    );

    await writeAudit(req, {
      eventType: "admin_create_user",
      success: true,
      userId: req.user?.id,
      username: req.user?.username,
      detail: { createdUserId: rows[0].id, createdUsername: rows[0].username, role: rows[0].role },
    });
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (e.code === "23505") {
      await writeAudit(req, {
        eventType: "admin_create_user",
        success: false,
        userId: req.user?.id,
        username: req.user?.username,
        detail: { reason: "username_exists" },
      });
      return res.status(409).json({ error: "Username already exists" });
    }
    next(e);
  }
});

export default router;
