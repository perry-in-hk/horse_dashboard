import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { createSessionMiddleware } from "./sessionStore.js";
import { requireAuth } from "./middleware/auth.js";
import { login, callback, logout, me } from "./routes/authHandlers.js";
import analyticsRouter from "./routes/analytics.js";
import dbRouter from "./routes/db.js";
import scraperRouter from "./routes/scraper.js";
import realtimeRouter from "./routes/realtime.js";
import aiRouter from "./routes/ai.js";
import { startOddsSyncWorker } from "./oddsSyncWorker.js";

const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

let sessionMiddleware;
try {
  sessionMiddleware = createSessionMiddleware();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
app.use(sessionMiddleware);

app.get("/api/auth/login", login);
app.get("/api/auth/callback", callback);

const protectedApi = express.Router();
protectedApi.use(requireAuth);
protectedApi.get("/auth/me", me);
protectedApi.post("/auth/logout", logout);
protectedApi.use("/analytics", analyticsRouter);
protectedApi.use("/db", dbRouter);
protectedApi.use("/scraper", scraperRouter);
protectedApi.use("/realtime", realtimeRouter);
protectedApi.use("/ai", aiRouter);

app.use("/api", protectedApi);

app.get("/health", async (_, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, service: "backend" });
});

const port = Number(process.env.PORT ?? 4000);

(async () => {
  try {
    await runMigrations();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const server = app.listen(port, () => {
    startOddsSyncWorker();
    console.log(`Backend listening on ${port}`);
  });

  server.on("error", (err) => {
    console.error(err);
  });
})();
