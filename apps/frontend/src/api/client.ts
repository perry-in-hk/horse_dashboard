const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const API_KEY = import.meta.env.VITE_API_KEY ?? "dev-hkjc-key";

const headers: Record<string, string> = { "x-api-key": API_KEY };

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}
