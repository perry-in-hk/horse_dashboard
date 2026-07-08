import { useMemo } from "react";
import { useNowTick } from "../hooks/useNowTick.ts";
import { formatHkNow, formatPostTimeDisplay, getCountdownState, parsePostTime } from "../lib/racePostTime.ts";

type RaceTimeContextProps = {
  meetingDate: string;
  race?: { postTime?: string; status?: string } | null;
};

export default function RaceTimeContext({ meetingDate, race }: RaceTimeContextProps) {
  const now = useNowTick(1000);

  const startAt = useMemo(() => parsePostTime(meetingDate, race?.postTime), [meetingDate, race?.postTime]);
  const countdown = useMemo(() => getCountdownState(now, startAt, race?.status), [now, race?.status, startAt]);

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
