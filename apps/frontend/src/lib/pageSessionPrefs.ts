const SHARED_MEETING_RACE_KEY = "hkjc_session_meeting_race";
const REALTIME_PREFS_KEY = "hkjc_session_realtime_prefs";

export type SharedMeetingRacePrefs = {
  meetingDate: string;
  venueCode: string;
  raceNo: number;
};

export type RealtimeSessionPrefs = {
  chartPool: string;
  tablePool: string;
  lockPools: boolean;
  timelineHours: number;
  refreshMs: number;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readSharedMeetingRace(): SharedMeetingRacePrefs | null {
  const v = readJson<Partial<SharedMeetingRacePrefs>>(SHARED_MEETING_RACE_KEY);
  if (!v?.meetingDate || !v?.venueCode) return null;
  const raceNo = parseInt(String(v.raceNo), 10);
  if (!Number.isFinite(raceNo) || raceNo < 1) return null;
  return {
    meetingDate: String(v.meetingDate).slice(0, 10),
    venueCode: String(v.venueCode),
    raceNo,
  };
}

export function writeSharedMeetingRace(prefs: SharedMeetingRacePrefs): void {
  writeJson(SHARED_MEETING_RACE_KEY, prefs);
}

export function readRealtimeSessionPrefs(): Partial<RealtimeSessionPrefs> | null {
  return readJson<Partial<RealtimeSessionPrefs>>(REALTIME_PREFS_KEY);
}

export function writeRealtimeSessionPrefs(prefs: RealtimeSessionPrefs): void {
  writeJson(REALTIME_PREFS_KEY, prefs);
}

export function resolveMeetingIndex(
  meetings: { date?: string; venueCode?: string }[],
  prefs: Pick<SharedMeetingRacePrefs, "meetingDate" | "venueCode"> | null
): number {
  if (!prefs || !meetings.length) return 0;
  const idx = meetings.findIndex(
    (m) =>
      String(m.date ?? "").slice(0, 10) === prefs.meetingDate &&
      String(m.venueCode ?? "") === prefs.venueCode
  );
  return idx >= 0 ? idx : 0;
}

export function resolveRaceNo(raceNumbers: number[], preferred: number | null | undefined): number {
  if (!raceNumbers.length) return 1;
  if (preferred != null && raceNumbers.includes(preferred)) return preferred;
  return raceNumbers[0];
}
