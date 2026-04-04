/** Normalize user/API horse codes: trim, uppercase, dedupe. */
export function normalizeHorseCodes(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const x of input) {
    if (typeof x !== "string") continue;
    const t = x.trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
