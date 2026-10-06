import { z } from "zod";
import type { BrowserAction, BrowserObservation } from "../integrations/jev-browser.js";

export const browserActionSchema = z.object({
  type: z.enum(["click","type","scroll","navigate","wait"]),
  target: z.string().min(1).optional(),
  value: z.string().optional()
});

export const browserObservationSchema = z.object({
  url: z.string().url(),
  action: browserActionSchema,
  result: z.enum(["success","blocked","failed"]),
  observation: z.string().min(1),
  screenshotUrl: z.string().url().optional(),
  collectedAt: z.string().datetime()
});

export function validateBrowserActions(actions: unknown[]): BrowserAction[] {
  return actions.map((action) => browserActionSchema.parse(action));
}

export function validateBrowserObservations(observations: unknown[]): BrowserObservation[] {
  return observations.map((observation) => browserObservationSchema.parse(observation));
}
