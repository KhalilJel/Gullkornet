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

type Priority = "HIGH REVIEW" | "MEDIUM REVIEW" | "LOW REVIEW" | "MANUAL RESEARCH";

function priorityFor(item: ResearchResult): Priority {
  const evidence = (item.personalizationEvidence ?? "").toLocaleLowerCase("nb-NO");
  if (evidence.includes("kontakt- eller bestillingslenke")) return "HIGH REVIEW";
  if (evidence.includes("sidetittelen")) return "MEDIUM REVIEW";
  if (evidence.includes("metabeskrivelse")) return "LOW REVIEW";
  return "MANUAL RESEARCH";
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
  const priorityOrder: Record<Priority, number> = {
    "HIGH REVIEW": 0,
    "MEDIUM REVIEW": 1,
    "LOW REVIEW": 2,
    "MANUAL RESEARCH": 3
  };
  const ranked = drafts
    .map((item) => ({ item, priority: priorityFor(item) }))
    .sort((a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      Number(b.item.emails.length > 0) - Number(a.item.emails.length > 0) ||
      a.item.companyName.localeCompare(b.item.companyName, "nb")
    );

  const counts = Object.fromEntries(
    (Object.keys(priorityOrder) as Priority[]).map((priority) => [
      priority,
      ranked.filter((row) => row.priority === priority).length
    ])
  ) as Record<Priority, number>;

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
    `- Høy prioritet for manuell vurdering (kontaktvei): ${counts["HIGH REVIEW"]}`,
    `- Middels prioritet (sidetittel): ${counts["MEDIUM REVIEW"]}`,
    `- Lav prioritet (metabeskrivelse): ${counts["LOW REVIEW"]}`,
    "",
    "## Utkast sortert for gjennomgang",
    ""
  ];

  for (const [index, row] of ranked.entries()) {
    const item = row.item;
    lines.push(
      `### ${index + 1}. ${item.companyName}`,
      "",
      `- **Gjennomgangsnivå:** ${row.priority}`,
      `- **By:** ${item.city ?? "Ikke oppgitt"}`,
      `- **Nettside:** ${item.websiteUrl ? "[" + item.websiteUrl + "](" + item.websiteUrl + ")" : "Ikke oppgitt"}`,
      `- **Kontaktadresse:** ${item.emails.length ? item.emails.map((entry) => "`" + entry.email + "`").join(", ") : "Ingen offentlig e-post funnet"}`,
      `- **Dokumentert observasjon:** ${item.personalizationEvidence ?? "Ingen konkret observasjon tilgjengelig"}`,
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
      "**Kontroller før eventuell kontakt:** at observasjonen fortsatt stemmer, at mottakeren er riktig person/bedrift, at e-postadressen er relevant, og at kontakt er lovlig og ønsket.",
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
