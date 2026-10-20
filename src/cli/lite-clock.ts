import { planClockHop } from "../lite/clock.js";

// npm run --silent lite:clock -> prints one line for the workflow: "<sleepSeconds> <action|none> <eventIso>"
const plan = planClockHop(Date.now());
console.log(`${Math.ceil(plan.sleepMs / 1000)} ${plan.fire ?? "none"} ${new Date(plan.atMs).toISOString()}`);
