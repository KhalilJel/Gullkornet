import { DEFAULT_SENDER } from "../integrations/outbound-email.js";

// Gullkornet Lite: one fixed, owner-approved message for every recipient.
// No personalization, no AI, no claims about the recipient's own website.
// Changing the wording requires a new owner approval; bump LITE_TEMPLATE_VERSION when you do.

export const LITE_TEMPLATE_VERSION = "2026-10-15.6";

/** Lite sells Cidea Marketing only. Cidea Leads and Cidea Consulting are paused as sales lines. */
export const LITE_BRAND = "Cidea Marketing";
/** Display name + the locked sender address. Only Lite uses the display name. */
export const LITE_FROM = `${LITE_BRAND} <${DEFAULT_SENDER}>`;

export const LITE_TEMPLATE = Object.freeze({
  subject: "Dette la vi merke til hos dere",
  text: [
    "Hei,",
    "",
    "Vi har sett på hvordan bedrifter presenterer seg digitalt, og fant noen områder hvor små forbedringer kan gjøre det enklere å tiltrekke seg nye kunder og få flere til å ta kontakt.",
    "",
    "Det fikk oss til å tenke på dere, og vi har en idé vi tror kan være relevant.",
    "",
    "Er dere interessert i at vi sender dere en kort forklaring?",
    "",
    "Mvh",
    "Jelassi",
    LITE_BRAND
  ].join("\n")
});

// Same opt-out phrases the advanced sender requires (airtable-send-approval.ts).
const OPT_OUT = /(?:nei takk|ikke ønsker flere|stoppe henvendelser)/i;
// Owner requirement: always address the business as "dere", never "du", "deg" or possessive singular.
const SINGULAR_YOU = /(?<![\p{L}])(?:du|deg|din|ditt|dine)(?![\p{L}])/iu;
const FIRST_PERSON_SINGULAR = /(?<![\p{L}])(?:jeg|meg|min|mitt|mine)(?![\p{L}])/iu;
const OTHER_BRANDS = /cidea\s+(?:leads|consulting)/i;

/** Structural checks only, not a legal approval. Owner explicitly removed the final line on 15 October.
 * The exception applies only to the exact approved copy; arbitrary opt-out-free variants still fail. */
export function assertLiteTemplateCompliant(template: { subject: string; text: string } = LITE_TEMPLATE): void {
  if (!template.subject.trim() || !template.text.trim()) throw new Error("Lite template is empty. Refusing to send.");
  if (/[\r\n]/.test(template.subject)) throw new Error("Lite template subject must be a single line. Refusing to send.");
  const exactApprovedCopy = template.subject === LITE_TEMPLATE.subject && template.text === LITE_TEMPLATE.text;
  if (!exactApprovedCopy && !OPT_OUT.test(template.text)) throw new Error("Unapproved Lite template must contain an opt-out line. Refusing to send.");
  if (!template.text.includes(LITE_BRAND)) throw new Error(`Lite template must identify the sender (${LITE_BRAND}). Refusing to send.`);
  if (SINGULAR_YOU.test(template.subject) || SINGULAR_YOU.test(template.text)) {
    throw new Error("Lite template must address the business as \"dere\", never \"du\". Refusing to send.");
  }
  if (FIRST_PERSON_SINGULAR.test(template.subject) || FIRST_PERSON_SINGULAR.test(template.text)) {
    throw new Error("Lite template must speak as vi, never jeg. Refusing to send.");
  }
  if (OTHER_BRANDS.test(template.subject) || OTHER_BRANDS.test(template.text)) {
    throw new Error(`Lite sells ${LITE_BRAND} only. Refusing to send.`);
  }
}
