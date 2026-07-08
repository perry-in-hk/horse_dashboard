import { createClient } from "redis";

let redis = null;
let warned = false;

export async function getRedisClient() {
  if (redis) return redis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  redis = createClient({ url });
  redis.on("error", (err) => {
    if (!warned) {
      warned = true;
      console.warn("[redis] connection error:", err?.message ?? err);
    }
  });
  await redis.connect();
  return redis;
}

