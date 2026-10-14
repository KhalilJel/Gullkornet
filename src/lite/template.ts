// Gullkornet Lite: one fixed, owner-approved message for every recipient.
// No personalization, no AI, no claims about the recipient's own website.
// Changing the wording requires a new owner approval; bump LITE_TEMPLATE_VERSION when you do.

export const LITE_TEMPLATE_VERSION = "2026-10-14.1";

export const LITE_TEMPLATE = Object.freeze({
  subject: "Dette la vi merke til hos dere",
  text: [
    "Hei,",
    "",
    "Vi har sett på hvordan bedrifter presenterer seg digitalt, og fant noen områder hvor små forbedringer kan gjøre det enklere å tiltrekke seg nye kunder og få flere til å ta kontakt.",
    "",
    "Det fikk oss til å tenke på dere, og vi har en idé vi tror kan være relevant.",
    "",
    "Er du åpen for at jeg sender deg en kort forklaring?",
    "",
    "Mvh",
    "Jelassi",
    "Cidea Marketing",
    "",
    "Gi gjerne beskjed dersom dere ikke ønsker flere henvendelser."
  ].join("\n")
});

// Same opt-out phrases the advanced sender requires (airtable-send-approval.ts).
const OPT_OUT = /(?:nei takk|ikke ønsker flere|stoppe henvendelser)/i;

/** Fails closed if the template ever loses its sender identification or opt-out line. */
export function assertLiteTemplateCompliant(template: { subject: string; text: string } = LITE_TEMPLATE): void {
  if (!template.subject.trim() || !template.text.trim()) throw new Error("Lite template is empty. Refusing to send.");
  if (/[\r\n]/.test(template.subject)) throw new Error("Lite template subject must be a single line. Refusing to send.");
  if (!OPT_OUT.test(template.text)) throw new Error("Lite template must contain an opt-out line. Refusing to send.");
  if (!template.text.includes("Cidea Marketing")) throw new Error("Lite template must identify the sender (Cidea Marketing). Refusing to send.");
}
