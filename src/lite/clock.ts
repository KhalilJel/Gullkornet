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
