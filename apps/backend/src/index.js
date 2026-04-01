import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import analyticsRouter from "./routes/analytics.js";
import dbRouter from "./routes/db.js";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const apiKey = process.env.API_KEY;
app.use("/api", (req, res, next) => {
  if (!apiKey) return next();
  if (req.headers["x-api-key"] !== apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.use("/api/analytics", analyticsRouter);
app.use("/api/db", dbRouter);

app.get("/health", async (_, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, service: "backend" });
});

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, async () => {
  await runMigrations();
  console.log(`Backend listening on ${port}`);
});

server.on("error", (err) => {
  console.error(err);
});
