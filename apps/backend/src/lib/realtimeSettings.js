const MIN_MS = 5000;
const MAX_MS = 120000;

function clamp(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return MIN_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(n)));
}

const envInterval = parseInt(process.env.ODDS_SYNC_INTERVAL_MS ?? "10000", 10);
let workerIntervalMs = clamp(Number.isFinite(envInterval) ? envInterval : 10000);

export function getWorkerIntervalMs() {
  return workerIntervalMs;
}

/** @param {number} ms */
export function setWorkerIntervalMs(ms) {
  workerIntervalMs = clamp(ms);
  return workerIntervalMs;
}
