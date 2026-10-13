// Autonomous send schedule: weekdays 09:00 (inclusive) to 15:00 (exclusive) Europe/Oslo,
// at least five minutes between emails. The window is never widened or the interval shortened:
// 6 h at 5 min allows at most 72 sends per day, below the 100/day hard ceiling.
export const SEND_SCHEDULE = Object.freeze({
  timeZone: "Europe/Oslo",
  startHour: 9,
  endHour: 15,
  minSpacingMs: 5 * 60 * 1000
});

/** A normal "not now" outcome (spacing, hourly or daily limit) that a scheduled run should treat as a no-op, not a failure. */
export class SendDeferredError extends Error {}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export type OsloClock = { weekday: number; hour: number; minute: number; date: string };

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SEND_SCHEDULE.timeZone,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function osloClock(ms: number): OsloClock {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) parts[part.type] = part.value;
  return {
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`
  };
}

export function isWithinSendWindow(ms: number): boolean {
  const clock = osloClock(ms);
  return clock.weekday >= 1 && clock.weekday <= 5 &&
    clock.hour >= SEND_SCHEDULE.startHour && clock.hour < SEND_SCHEDULE.endHour;
}

export function assertWithinSendWindow(ms = Date.now()): void {
  if (!isWithinSendWindow(ms)) {
    throw new Error("Outside the send window (Monday-Friday 09:00-15:00 Europe/Oslo). Refusing to send.");
  }
}

/** Fails closed on unparseable or future-dated ledger entries. */
export function assertMinimumSpacing(entries: Array<{ created_at: string }>, nowMs = Date.now()): void {
  let newest = -Infinity;
  for (const entry of entries) {
    const timestamp = Date.parse(entry.created_at);
    if (!Number.isFinite(timestamp)) throw new Error("Send ledger contains an invalid timestamp. Refusing to send.");
    if (timestamp > newest) newest = timestamp;
  }
  if (newest === -Infinity) return;
  const age = nowMs - newest;
  if (age < 0) throw new Error("Send ledger contains a future-dated entry. Refusing to send.");
  if (age < SEND_SCHEDULE.minSpacingMs) {
    throw new SendDeferredError("The previous email was sent less than five minutes ago. Refusing to send.");
  }
}
