import { readFile, writeFile } from "node:fs/promises";

type ResearchResult = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  researchStatus: string;
  emails: Array<{ email: string; sourceUrl: string; sourceType: string }>;
  subject?: string;
  draftBody?: string;
  personalizationEvidence?: string;
  contactPageUrl?: string;
  notes: string[];
  requiresHumanReview: true;
};

type ContactReview = "VERIFY CONTACT" | "CONTACT FOUND — NOT VERIFIED" | "NO PUBLIC EMAIL";

function contactReviewFor(item: ResearchResult): ContactReview {
  if (item.notes.some((note) => note.includes("MANUAL REVIEW:"))) return "VERIFY CONTACT";
  if (item.emails.length > 0) return "CONTACT FOUND — NOT VERIFIED";
  return "NO PUBLIC EMAIL";
}

function observationFor(item: ResearchResult): string {
  const evidence = item.personalizationEvidence?.trim();
  if (!evidence || /no specific website claim|no concrete|ingen konkret/i.test(evidence)) {
    return "Ingen konkret nettsideobservasjon er bekreftet. E-postutkastet er en generell åpner.";
  }
  return evidence;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const inputPath = process.argv[2] ?? "data/contact-research-drafts.json";
const outputPath = process.argv[3] ?? "data/lead-review-queue.md";
const senderEmail = process.env.OUTREACH_FROM_EMAIL?.trim() || "jelassi@smartsvar.no";

try {
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Contact research input must be a JSON array.");
  const results = parsed as ResearchResult[];
  const drafts = results.filter((item) => Boolean(item.draftBody && item.subject));
  const reviewOrder: Record<ContactReview, number> = {
    "VERIFY CONTACT": 0,
    "CONTACT FOUND — NOT VERIFIED": 1,
    "NO PUBLIC EMAIL": 2
  };
  const ranked = drafts
    .map((item) => ({ item, contactReview: contactReviewFor(item) }))
    .sort((a, b) =>
      reviewOrder[a.contactReview] - reviewOrder[b.contactReview] ||
      a.item.companyName.localeCompare(b.item.companyName, "nb")
    );

  const counts = Object.fromEntries(
    (Object.keys(reviewOrder) as ContactReview[]).map((status) => [
      status,
      ranked.filter((row) => row.contactReview === status).length
    ])
  ) as Record<ContactReview, number>;

  const lines = [
    "# Gullkornet — manuell leadgjennomgang",
    "",
    `Generert: ${new Date().toISOString()}`,
    `Planlagt avsender: ${senderEmail}`,
    "",
    "> Dette er en gjennomgangskø, ikke en liste over kvalifiserte salgsmuligheter. Prioritet beskriver kun typen observerte nettsidefunn. Alle funn og mottakere må kontrolleres manuelt. Ingen e-poster er sendt. Planlagt avsender er kun metadata; avsenderkonto og utsending er ikke verifisert eller aktivert.",
    "",
    "## Sammendrag",
    "",
    `- Bedrifter behandlet: ${results.length}`,
    `- Utkast generert: ${drafts.length}`,
    `- Utkast med offentlig e-postadresse: ${drafts.filter((item) => item.emails.length > 0).length}`,
    `- Må verifisere kontaktadresse manuelt: ${counts["VERIFY CONTACT"]}`,
    `- Kontaktadresse funnet, men ikke verifisert: ${counts["CONTACT FOUND — NOT VERIFIED"]}`,
    `- Ingen offentlig e-post funnet: ${counts["NO PUBLIC EMAIL"]}`,
    "",
    "## Utkast sortert for gjennomgang",
    ""
  ];

  for (const [index, row] of ranked.entries()) {
    const item = row.item;
    lines.push(
      `### ${index + 1}. ${item.companyName}`,
      "",
      `- **Kontaktstatus:** ${row.contactReview}`,
      `- **By:** ${item.city ?? "Ikke oppgitt"}`,
      `- **Nettside:** ${item.websiteUrl ? "[" + item.websiteUrl + "](" + item.websiteUrl + ")" : "Ikke oppgitt"}`,
      `- **Kontaktadresse:** ${item.emails.length ? item.emails.map((entry) => "`" + entry.email + "`").join(", ") : "Ingen offentlig e-post funnet"}`,
      `- **Dokumentert observasjon:** ${observationFor(item)}`,
      `- **Kontakt-/informasjonsside:** ${item.contactPageUrl ? "[" + item.contactPageUrl + "](" + item.contactPageUrl + ")" : "Ikke funnet"}`,
      "",
      "**E-postutkast — ikke sendt**",
      "",
      "```text",
      item.subject ?? "Uten emne",
      "",
      item.draftBody ?? "Ingen e-posttekst generert.",
      "```",
      "",
      "**Kontroller før eventuell kontakt:** åpne kildesiden for hver adresse, bekreft at adressen tilhører riktig bedrift og relevant mottaker, kontroller at eventuell observasjon faktisk stemmer, og vurder om kontakt er lovlig og ønsket. En offentlig adresse er ikke i seg selv tillatelse til markedsføring.",
      "",
      "---",
      ""
    );
  }

  lines.push(
    "## Bedrifter uten utkast",
    "",
    ...results.filter((item) => !item.draftBody || !item.subject).map((item) =>
      `- **${escapeCell(item.companyName)}** — ${item.researchStatus}; ${escapeCell(item.notes.join(" "))}`
    ),
    ""
  );

  await writeFile(outputPath, lines.join("\n"), "utf8");
  console.error(`Review queue written to ${outputPath}: ${drafts.length} drafts, ${results.length - drafts.length} without drafts. Nothing was sent.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to build lead review queue.");
  process.exitCode = 1;
}
