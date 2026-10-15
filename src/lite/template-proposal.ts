import { LITE_BRAND } from "./template.js";

// PROPOSAL ONLY, NOT USED FOR SENDING. The approved template is LITE_TEMPLATE in template.ts
// (version 2026-10-14.2) and stays unchanged until the owner approves this text.
// Changes from 2026-10-14.2, for ehandelsloven §§ 8-9 and GDPR art. 14:
//   - subject shows that the email is marketing and from whom (ehl. § 9: clear "når de mottas")
//   - footer carries the legal entity, org. no., address and email (ehl. § 8)
//   - one line on where the address came from and a link to the privacy notice (GDPR art. 14)
// The body sentences and the opt-out line are word for word the approved ones.
// CIDEA AS was confirmed by the owner. The privacy notice must be live and verified before use.

export const LITE_TEMPLATE_PROPOSAL_VERSION = "forslag-2026-10-15.4";

export const LITE_TEMPLATE_PROPOSAL = Object.freeze({
  subject: `Reklame fra ${LITE_BRAND}: en idé til forbedring hos dere`,
  text: [
    "Hei,",
    "",
    "Vi har sett på hvordan bedrifter i deres marked presenterer seg digitalt, og mener det finnes muligheter for å forbedre hvordan dere tiltrekker dere nye kunder.",
    "",
    "Vi har en konkret idé som vi tror kan gjøre det enklere for potensielle kunder å finne dere og ta kontakt.",
    "",
    "Er dere åpne for at vi sender dere en kort forklaring?",
    "",
    "Mvh",
    "Jelassi",
    LITE_BRAND,
    "",
    "Gi gjerne beskjed dersom dere ikke ønsker flere henvendelser.",
    "",
    "--",
    `Denne e-posten er markedsføring fra ${LITE_BRAND} (CIDEA AS, org.nr. 927 394 391, Gunnar Schjelderups vei 13A, 0485 Oslo, hello@cideamarketing.com).`,
    "Vi fant bedriftens e-postadresse i Enhetsregisteret. Vi bruker opplysningene for én henvendelse om våre tjenester, basert på berettiget interesse. Dere kan når som helst protestere mot videre markedsføring ved å svare på e-posten. Les om lagring, rettigheter og kontakt: https://cideamarketing.com/personvern"
  ].join("\n")
});

/** Preview only. Never infer a source when provenance is missing or unknown. */
export function liteTemplateProposalForSource(source: "brreg" | "website"): { subject: string; text: string } {
  if (source !== "brreg" && source !== "website") throw new Error("Unknown contact source; refusing to render a proposal.");
  return { subject: LITE_TEMPLATE_PROPOSAL.subject, text: source === "brreg" ? LITE_TEMPLATE_PROPOSAL.text
    : LITE_TEMPLATE_PROPOSAL.text.replace("i Enhetsregisteret.", "på bedriftens egen nettside.") };
}
