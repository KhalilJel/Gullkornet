import { missedClockEvent, planClockHop } from "../lite/clock.js";

// npm run --silent lite:clock -> one line for the workflow:
// "<sleepSeconds> <action|none> <eventIso> <missedAction|none> <missedEventIso|->"
const now = Date.now();
const plan = planClockHop(now);
const missed = missedClockEvent(now);
console.log(`${Math.ceil(plan.sleepMs / 1000)} ${plan.fire ?? "none"} ${new Date(plan.atMs).toISOString()} ` +
  `${missed?.action ?? "none"} ${missed ? new Date(missed.atMs).toISOString() : "-"}`);
