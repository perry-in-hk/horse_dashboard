import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db.js";

const PgSession = connectPgSimple(session);

export function createSessionMiddleware() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is required (set a long random string in .env)");
  }
  const maxAgeHours = Number.parseInt(process.env.SESSION_MAX_AGE_HOURS ?? "24", 10);
  const sessionMaxAgeMs =
    Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  return session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    name: "hkjc.sid",
    cookie: {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge: sessionMaxAgeMs,
      path: "/",
    },
  });
}
