import { osloClock } from "../integrations/send-schedule.js";

// The daily Lite timetable, in Europe/Oslo wall-clock time (summer and winter time alike).
// GitHub's own schedule delivers this repository's events hours late or not at all, so a
// self-re-arming "clock" workflow sleeps until the next event and dispatches it.

export type ClockAction = "intake" | "readiness" | "outreach" | "reserve" | "report";

export const LITE_TIMETABLE: ReadonlyArray<{ at: string; action: ClockAction }> = Object.freeze([
  { at: "06:40", action: "intake" },    // top up the Lite Ready queue
  { at: "08:10", action: "readiness" }, // read-only check that >= 115 of 150 are eligible
  { at: "10:40", action: "outreach" },  // the day's run; it waits for 11:00 itself
  { at: "11:20", action: "reserve" },   // continues the same slot only if nothing is running
  { at: "12:10", action: "report" }     // accepted / delivered / bounced vs capacity
]);

/** The instant at which Oslo wall-clock shows date (YYYY-MM-DD) and hh:mm (never in a DST gap at these hours). */
export function osloInstant(date: string, hhmm: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  for (const offsetHours of [1, 2]) {
    const ms = Date.UTC(y, mo - 1, d, h - offsetHours, mi);
    const c = osloClock(ms);
    if (c.date === date && c.hour === h && c.minute === mi) return ms;
  }
  throw new Error(`No Oslo instant for ${date} ${hhmm}.`);
}

/** The next timetable event strictly after nowMs (looks up to two days ahead). */
export function nextClockEvent(nowMs: number, timetable = LITE_TIMETABLE): { action: ClockAction; atMs: number } {
  for (let day = 0; day < 3; day++) {
    const date = osloClock(nowMs + day * 86_400_000).date;
    for (const event of timetable) {
      const atMs = osloInstant(date, event.at);
      if (atMs > nowMs) return { action: event.action, atMs };
    }
  }
  throw new Error("No clock event in the next three days.");
}

/** GitHub ends a job after 6 h; one clock hop sleeps at most this long, then re-arms. */
export const MAX_HOP_MS = 5.5 * 3_600_000;

/** What one clock run does: sleep, then either fire the event or just re-arm (when it is further than one hop). */
export function planClockHop(nowMs: number): { sleepMs: number; fire?: ClockAction; atMs: number } {
  const next = nextClockEvent(nowMs);
  const wait = next.atMs - nowMs;
  if (wait > MAX_HOP_MS) return { sleepMs: MAX_HOP_MS, atMs: next.atMs };
  return { sleepMs: wait, fire: next.action, atMs: next.atMs };
}

/**
 * How long after its time an event is still worth starting when the clock was late (a re-armed run
 * queued behind GitHub, a cancelled or crashed hop). Outreach is useful until shortly before 12:00;
 * the reserve only until the main run would have been checked; reports and intake for hours.
 */
export const CLOCK_GRACE_MS: Readonly<Record<ClockAction, number>> = Object.freeze({
  intake: 3 * 3_600_000,
  readiness: 2 * 3_600_000,
  outreach: 75 * 60_000,
  reserve: 30 * 60_000,
  report: 3 * 3_600_000
});

/**
 * The latest event whose time has passed but is still inside its grace period. The workflow starts
 * it only after checking on GitHub that no run of its workflow was created since the event's time,
 * so a run that follows an on-time dispatch does not start the same event twice.
 */
export function missedClockEvent(nowMs: number, timetable = LITE_TIMETABLE): { action: ClockAction; atMs: number } | undefined {
  let latest: { action: ClockAction; atMs: number } | undefined;
  for (const dayOffset of [-1, 0]) {
    const date = osloClock(nowMs + dayOffset * 86_400_000).date;
    for (const event of timetable) {
      const atMs = osloInstant(date, event.at);
      if (atMs <= nowMs && (!latest || atMs > latest.atMs)) latest = { action: event.action, atMs };
    }
  }
  return latest && nowMs - latest.atMs <= CLOCK_GRACE_MS[latest.action] ? latest : undefined;
}
