const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const API_KEY = import.meta.env.VITE_API_KEY ?? "dev-hkjc-key";

const headers: Record<string, string> = { "x-api-key": API_KEY };

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: string; conflictingDates?: string[] };
      if (j?.error && Array.isArray(j.conflictingDates) && j.conflictingDates.length) {
        throw new Error(`API ${res.status}: ${j.error} (${j.conflictingDates.join(", ")})`);
      }
      if (j?.error) throw new Error(`API ${res.status}: ${j.error}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("API ")) throw e;
    }
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}
