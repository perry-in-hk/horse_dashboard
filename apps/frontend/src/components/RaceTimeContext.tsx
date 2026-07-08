import { useMemo } from "react";
import { useNowTick } from "../hooks/useNowTick.ts";
import { formatHkNow, formatPostTimeDisplay, getCountdownState, parsePostTime } from "../lib/racePostTime.ts";

type RaceTimeContextProps = {
  meetingDate: string;
  race?: { postTime?: string; status?: string } | null;
  variant?: "default" | "compact";
};

export default function RaceTimeContext({ meetingDate, race, variant = "default" }: RaceTimeContextProps) {
  const now = useNowTick(1000);

  const startAt = useMemo(() => parsePostTime(meetingDate, race?.postTime), [meetingDate, race?.postTime]);
  const countdown = useMemo(() => getCountdownState(now, startAt, race?.status), [now, race?.status, startAt]);

  if (variant === "compact") {
    return (
      <div className="race-time-compact" aria-label="開賽時間與倒數">
        <div className="race-time-stat">
          <span className="race-time-stat-label">開賽</span>
          <strong className="race-time-stat-value">{formatPostTimeDisplay(startAt)}</strong>
        </div>
        <div className="race-time-stat">
          <span className="race-time-stat-label">倒數</span>
          <strong className={`race-time-stat-value race-time-countdown`}>{countdown.label}</strong>
        </div>
      </div>
    );
  }

  return (
    <p className="muted race-time-context">
      開賽時間：<strong>{formatPostTimeDisplay(startAt)}</strong>
      <span className="race-time-sep">·</span>
      現時時間：<strong>{formatHkNow(now)}</strong>
      <span className="race-time-sep">·</span>
      倒數：<strong className="race-time-countdown">{countdown.label}</strong>
    </p>
  );
}
