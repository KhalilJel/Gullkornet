import { validFindings, type Finding } from "./research-evidence.js";

// Deterministic, auditable routing of one researched company to the three Cidea units
// (docs/GULLKORNET-OPPORTUNITY-ENGINE.md). No model is involved, so the same evidence always
// gives the same result and the rule version below identifies exactly what produced it.
// A unit with no supporting fact scores 0 with confidence 0: the engine says "insufficient
// evidence" instead of inventing an opportunity.

export const ROUTING_RULES_VERSION = "cidea-routing-rules@1";

export type CideaUnit = "CideaLead" | "CideaMarketing" | "CideaConsulting";
export type CideaRoute = CideaUnit | "STRATEGIC_ACCOUNT" | "NONE";

export const ROUTING_THRESHOLDS = Object.freeze({
  /** Minimum score and confidence for a unit to count as the recommended route. */
  routeScore: 40,
  routeConfidence: 0.5,
  /** Two or more units at or above these values make the company a strategic account. */
  strategicScore: 75,
  strategicConfidence: 0.6
});

export type UnitAssessment = {
  unit: CideaUnit;
  score: number;
  confidence: number;
  /** Signals (from facts) that produced the score, for audit. */
  signals: string[];
  opportunity?: string;
};

export type RoutingInput = {
  /** Source-backed findings; malformed ones are discarded. */
  findings: unknown[];
  hasWebsite: boolean;
  /** "complete" when the website was read fully; "partial" or "insufficient" lowers confidence. */
  completeness: "complete" | "partial" | "insufficient";
  now?: () => Date;
};

export type RoutingAssessment = {
  ruleVersion: string;
  assessedAt: string;
  route: CideaRoute;
  units: UnitAssessment[];
  /** Facts used, then inferences and recommendations derived from them. */
  findings: Finding[];
  strategic: boolean;
  completeness: RoutingInput["completeness"];
};

// Points per observed fact signal. CideaConsulting has no website-derivable signal: digital
// maturity, AI adoption and process problems cannot be read from a homepage audit.
const SIGNAL_POINTS: Record<CideaUnit, Record<string, number>> = {
  CideaLead: {
    NO_WEBSITE: 60,
    HTTP_ERROR: 25,
    MISSING_VIEWPORT_META: 20,
    NOT_HTTPS: 15,
    NO_OBVIOUS_CONTACT_PATH: 15,
    MISSING_TITLE: 10,
    MISSING_META_DESCRIPTION: 10
  },
  CideaMarketing: {
    MISSING_META_DESCRIPTION: 30,
    MISSING_TITLE: 25,
    NO_OBVIOUS_CONTACT_PATH: 20,
    NO_SOCIAL_PRESENCE_FOUND: 25,
    NOT_HTTPS: 10
  },
  CideaConsulting: {}
};

const OPPORTUNITY: Record<CideaUnit, string> = {
  CideaLead: "Mulig behov for nytt eller forbedret nettsted og digital tilstedeværelse",
  CideaMarketing: "Mulig forbedringsområde for synlighet i søk og konvertering",
  CideaConsulting: "Ikke nok kildebelagt evidens til å vurdere digital eller operasjonell modenhet"
};

const COMPLETENESS_FACTOR = { complete: 1, partial: 0.8, insufficient: 0.5 } as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function assessUnit(unit: CideaUnit, facts: Finding[], completeness: RoutingInput["completeness"], hasWebsite: boolean): UnitAssessment {
  const points = SIGNAL_POINTS[unit];
  const signals = [...new Set(facts.map((fact) => fact.signal).filter((signal): signal is string => Boolean(signal && points[signal] !== undefined)))];
  // Marketing opportunities about a website cannot be judged for a company without one.
  const usable = unit === "CideaMarketing" && !hasWebsite ? [] : signals;
  const score = Math.min(100, usable.reduce((sum, signal) => sum + (points[signal] ?? 0), 0));
  if (usable.length === 0) return { unit, score: 0, confidence: 0, signals: [], opportunity: OPPORTUNITY[unit] };
  const factConfidence = usable.reduce((sum, signal) => {
    const best = Math.max(...facts.filter((fact) => fact.signal === signal).map((fact) => fact.confidence));
    return sum + best;
  }, 0) / usable.length;
  const breadth = Math.min(1, 0.5 + 0.15 * usable.length);
  const confidence = clamp01(Number((factConfidence * breadth * COMPLETENESS_FACTOR[completeness]).toFixed(2)));
  return { unit, score, confidence, signals: usable.sort(), opportunity: OPPORTUNITY[unit] };
}

export function assessCideaRouting(input: RoutingInput): RoutingAssessment {
  const now = (input.now ?? (() => new Date()))();
  const all = validFindings(input.findings);
  const facts = all.filter((finding) => finding.kind === "fact");
  const units = (["CideaLead", "CideaMarketing", "CideaConsulting"] as const)
    .map((unit) => assessUnit(unit, facts, input.completeness, input.hasWebsite));

  const strong = units.filter((unit) =>
    unit.score >= ROUTING_THRESHOLDS.strategicScore && unit.confidence >= ROUTING_THRESHOLDS.strategicConfidence);
  const candidates = units
    .filter((unit) => unit.score >= ROUTING_THRESHOLDS.routeScore && unit.confidence >= ROUTING_THRESHOLDS.routeConfidence)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  let route: CideaRoute = "NONE";
  if (strong.length >= 2) route = "STRATEGIC_ACCOUNT";
  else if (candidates[0]) route = candidates[0].unit;

  const derived: Finding[] = [];
  const timestamp = now.toISOString();
  for (const unit of units) {
    if (unit.signals.length === 0) continue;
    const support = facts.find((fact) => unit.signals.includes(fact.signal ?? ""));
    if (!support) continue;
    // An inference is a reading of the facts, never a fact. It cites the same public source.
    derived.push({
      kind: "inference",
      statement: `${unit.unit}: ${unit.opportunity} (basert på ${unit.signals.join(", ")}). Automatiske signaler må kontrolleres manuelt.`,
      sourceUrl: support.sourceUrl,
      retrievedAt: timestamp,
      confidence: unit.confidence,
      provider: "cidea-rules",
      signal: `${unit.unit}_OPPORTUNITY`
    });
  }
  if (route !== "NONE") {
    const top = route === "STRATEGIC_ACCOUNT" ? strong[0] : candidates[0];
    const support = top ? facts.find((fact) => top.signals.includes(fact.signal ?? "")) : undefined;
    if (top && support) {
      derived.push({
        kind: "recommendation",
        statement: route === "STRATEGIC_ACCOUNT"
          ? "Strategisk konto: dypere research kreves; ikke behandle som vanlig automatisk utsending."
          : `Anbefalt enhet: ${route}.`,
        sourceUrl: support.sourceUrl,
        retrievedAt: timestamp,
        confidence: top.confidence,
        provider: "cidea-rules",
        signal: `ROUTE_${route}`
      });
    }
  }

  return {
    ruleVersion: ROUTING_RULES_VERSION,
    assessedAt: timestamp,
    route,
    units,
    findings: [...facts, ...derived],
    strategic: route === "STRATEGIC_ACCOUNT",
    completeness: input.completeness
  };
}

export const ROUTE_NOTE_MARKER = "[GK-ROUTE:";

/** Compact audit lines stored in the existing Airtable "Research Notes" field. */
export function formatRoutingNotes(assessment: RoutingAssessment, attempts: Array<{ provider: string; outcome: string; reason?: string }> = []): string[] {
  const scores = assessment.units.map((unit) => `${unit.unit} ${unit.score} (konfidens ${unit.confidence.toFixed(2)})`).join("; ");
  const providers = attempts.length
    ? attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}${attempt.reason ? `(${attempt.reason})` : ""}`).join(", ")
    : "builtin-fetch:ok";
  const lines = [
    `${ROUTE_NOTE_MARKER}${assessment.route}] Regelsett ${assessment.ruleVersion}, vurdert ${assessment.assessedAt}, datagrunnlag ${assessment.completeness}.`,
    `Poeng: ${scores}.`,
    `Leverandører: ${providers}.`
  ];
  for (const finding of assessment.findings) {
    const label = finding.kind === "fact" ? "FAKTA" : finding.kind === "inference" ? "SLUTNING" : "ANBEFALING";
    lines.push(`${label} [${finding.provider}, ${finding.retrievedAt}, konfidens ${finding.confidence.toFixed(2)}] ${finding.statement} Kilde: ${finding.sourceUrl}`);
  }
  if (assessment.strategic) lines.push("STRATEGIC_ACCOUNT: skal ikke godkjennes automatisk for utsending.");
  return lines;
}
