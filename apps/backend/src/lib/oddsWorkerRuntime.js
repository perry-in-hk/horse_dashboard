/** In-memory targets for repeating interval sync (clears on server restart). */

/** @type {{ meeting_date: string; venue_code: string; race_no: number }[]} */
let activeIntervalTargets = [];

/**
 * Which race is being fetched right now (interval tick or full sweep).
 * @type {null | { kind: 'interval' | 'full'; meeting_date: string; venue_code: string; race_no: number }}
 */
let currentSync = null;

/** @type {boolean} */
let syncBusy = false;

/** @returns {{ meeting_date: string; venue_code: string; race_no: number }[]} */
export function getActiveIntervalTargets() {
  return activeIntervalTargets;
}

/** First target, for backward compatibility. */
export function getActiveIntervalTarget() {
  return activeIntervalTargets[0] ?? null;
}

/**
 * @param {{ meeting_date: string; venue_code: string; race_no: number }[]} targets
 */
export function setActiveIntervalTargets(targets) {
  activeIntervalTargets = targets.map((t) => ({
    meeting_date: String(t.meeting_date),
    venue_code: String(t.venue_code),
    race_no: Number(t.race_no),
  }));
}

/** @param {{ meeting_date: string; venue_code: string; race_no: number }} t */
export function setActiveIntervalTarget(t) {
  setActiveIntervalTargets([t]);
}

export function clearActiveIntervalTarget() {
  activeIntervalTargets = [];
}

export function getCurrentSync() {
  return currentSync;
}

/** @param {NonNullable<typeof currentSync>} c */
export function setCurrentSync(c) {
  currentSync = { ...c };
}

export function clearCurrentSync() {
  currentSync = null;
}

export function isSyncBusy() {
  return syncBusy;
}

export function beginSyncExclusive() {
  if (syncBusy) return false;
  syncBusy = true;
  return true;
}

export function endSyncExclusive() {
  syncBusy = false;
}
