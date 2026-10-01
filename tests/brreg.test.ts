import test from "node:test";
import assert from "node:assert/strict";
import { discoverBrregCandidates } from "../src/integrations/brreg.js";

test("maps active registry records and deduplicates by organization number", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({
      _embedded: {
        enheter: [
          {
            organisasjonsnummer: "999888777",
            navn: "Eksempel Regnskap AS",
            hjemmeside: "www.example.no",
            epostadresse: "POST@EXAMPLE.NO",
            antallAnsatte: 4,
            forretningsadresse: { kommune: "Oslo", kommunenummer: "0301" },
            naeringskode1: { beskrivelse: "Regnskap og bokføring" }
          },
          {
            organisasjonsnummer: "111222333",
            navn: "Slettet Regnskap AS",
            slettedato: "2025-01-01",
            forretningsadresse: { kommune: "Oslo", kommunenummer: "0301" }
          }
        ]
      },
      page: { totalPages: 1 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const results = await discoverBrregCandidates({
    municipalities: ["0301", "3201"],
    pagesPerMunicipality: 1,
    fetchImpl
  });

  assert.equal(urls.length, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.organizationNumber, "999888777");
  assert.equal(results[0]?.websiteUrl, "https://www.example.no");
  assert.equal(results[0]?.contactEmail, "post@example.no");
  assert.equal(results[0]?.city, "Oslo");
  assert.equal(results[0]?.industry, "Regnskap og bokføring");
});

test("fails clearly when the public registry request fails", async () => {
  const fetchImpl: typeof fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(
    () => discoverBrregCandidates({ municipalities: ["0301"], pagesPerMunicipality: 1, fetchImpl }),
    /BRREG_REQUEST_FAILED status=503/
  );
});
