import test from "node:test";
import assert from "node:assert/strict";
import { discoverGooglePlacesCandidates, NORWAY_SEARCH_MARKETS, selectFreshCandidates, type GooglePlacesCandidate } from "../src/integrations/google-places.js";

const place = (companyName: string, websiteUrl?: string): GooglePlacesCandidate => ({ companyName, websiteUrl, city: "Oslo", industry: "frisør" });
const noHistory = { domains: [], companyNames: [] };

test("the daily limit is filled with candidates that have a website first", () => {
  // Alphabetical input as discovery returns it; in pilot run 38409346860, 4 of 25 capped slots had no website.
  const selected = selectFreshCandidates(
    [place("A/S Uten Nett"), place("Aura", "https://aura.no/"), place("B Uten Nett"), place("Bech", "https://bech.no/"), place("Chess", "https://chess.no/")],
    noHistory,
    3
  );
  assert.deepEqual(selected.map((c) => c.companyName), ["Aura", "Bech", "Chess"]);
});

test("candidates without a website only fill slots left over, in their original order", () => {
  const selected = selectFreshCandidates([place("A Uten"), place("Aura", "https://aura.no/"), place("B Uten")], noHistory, 5);
  assert.deepEqual(selected.map((c) => c.companyName), ["Aura", "A Uten", "B Uten"]);
});

test("cross-run dedupe still drops known domains and names before the limit is applied", () => {
  const selected = selectFreshCandidates(
    [place("Aura", "https://www.aura.no/x"), place("Bech", "https://bech.no/"), place("Chess", "https://chess.no/"), place("Kjent Navn")],
    { domains: ["aura.no"], companyNames: ["  chess "] },
    10
  );
  assert.deepEqual(selected.map((c) => c.companyName), ["Bech", "Kjent Navn"]);
  assert.equal(selectFreshCandidates([place("Bech", "https://bech.no/")], noHistory, 0).length, 0);
});

test("default discovery markets span Norway beyond the Oslo area", () => {
  assert.equal(NORWAY_SEARCH_MARKETS.length, 15);
  for (const market of ["Oslo", "Bergen", "Trondheim", "Stavanger", "Bodø", "Tromsø", "Alta"]) {
    assert.ok(NORWAY_SEARCH_MARKETS.includes(market));
  }
  assert.ok(NORWAY_SEARCH_MARKETS.some((market) => ["Bodø", "Tromsø", "Alta"].includes(market)));
});

test("discovers candidates from Google Places and deduplicates by website domain", async () => {
  const requests: Array<{ url: string; body: string; fieldMask: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: String(init?.body ?? ""),
      fieldMask: new Headers(init?.headers).get("X-Goog-FieldMask")
    });
    const city = JSON.parse(String(init?.body)).textQuery.includes("Oslo") ? "Oslo" : "Bærum";
    return new Response(JSON.stringify({
      places: city === "Oslo"
        ? [
            { displayName: { text: "Eksempel Regnskap AS" }, websiteUri: "https://www.example.no", formattedAddress: "Oslo", addressComponents: [{ longText: "Norway", shortText: "NO", types: ["country"] }], googleMapsUri: "https://maps.google.com/example" },
            { displayName: { text: "Wrong Country Restaurant" }, websiteUri: "https://brgrill.com/brambleton/", formattedAddress: "Brambleton, VA, USA", googleMapsUri: "https://maps.google.com/wrong-country" },
            { displayName: { text: "Address Missing Restaurant" }, websiteUri: "https://missing.example", googleMapsUri: "https://maps.google.com/missing-address" },
            { displayName: { text: "Uten nettside Regnskap" }, formattedAddress: "Oslo, Norway" }
          ]
        : [
            { displayName: { text: "Eksempel Regnskap AS" }, websiteUri: "https://example.no/", formattedAddress: "Bærum, Norway" }
          ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const results = await discoverGooglePlacesCandidates({
    apiKey: "test-key",
    cities: ["Oslo", "Bærum"],
    maxResultsPerCity: 10,
    fetchImpl
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(requests[0]?.fieldMask?.includes("places.websiteUri"), true);
  assert.equal(requests[0]?.fieldMask?.includes("places.addressComponents"), true);
  assert.equal(results.length, 2);
  assert.equal(results.some((item) => item.companyName === "Wrong Country Restaurant"), false);
  assert.equal(results.some((item) => item.companyName === "Address Missing Restaurant"), false);
  assert.equal(results.find((item) => item.companyName === "Eksempel Regnskap AS")?.city, "Oslo");
  assert.equal(results.find((item) => item.companyName === "Eksempel Regnskap AS")?.websiteUrl, "https://www.example.no/");
});

// ---- Opt-in pagination: one page by default, at most 3 billed requests per city ----

function pagedFetch(pagesAvailable: number, log: Array<{ pageToken?: string; fieldMask: string | null; textQuery: string }>): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    log.push({ pageToken: body.pageToken, fieldMask: new Headers(init?.headers).get("X-Goog-FieldMask"), textQuery: body.textQuery });
    const page = body.pageToken ? Number(String(body.pageToken).replace("tok", "")) : 1;
    return new Response(JSON.stringify({
      places: [{ displayName: { text: `Salong ${page}` }, websiteUri: `https://salong${page}.no/`, formattedAddress: "Oslo, Norway" }],
      ...(page < pagesAvailable ? { nextPageToken: `tok${page + 1}` } : {})
    }), { status: 200 });
  };
}

test("pagination is off by default: one request per city and no nextPageToken in the field mask", async () => {
  const log: Array<{ pageToken?: string; fieldMask: string | null; textQuery: string }> = [];
  const results = await discoverGooglePlacesCandidates({ apiKey: "k", cities: ["Oslo"], fetchImpl: pagedFetch(3, log) });
  assert.equal(log.length, 1);
  assert.equal(log[0].fieldMask?.includes("nextPageToken"), false);
  assert.deepEqual(results.map((c) => c.companyName), ["Salong 1"]);
});

test("opt-in pagination follows nextPageToken with the same query, up to the page limit", async () => {
  const log: Array<{ pageToken?: string; fieldMask: string | null; textQuery: string }> = [];
  const results = await discoverGooglePlacesCandidates({ apiKey: "k", cities: ["Oslo"], maxPagesPerCity: 2, fetchImpl: pagedFetch(3, log) });
  assert.deepEqual(log.map((r) => r.pageToken), [undefined, "tok2"]);
  assert.ok(log.every((r) => r.textQuery === log[0].textQuery && r.fieldMask?.includes("nextPageToken")));
  assert.deepEqual(results.map((c) => c.companyName), ["Salong 1", "Salong 2"]);
});

test("pagination stops when Google returns no token, and is capped at 3 pages", async () => {
  const short: Array<{ pageToken?: string; fieldMask: string | null; textQuery: string }> = [];
  await discoverGooglePlacesCandidates({ apiKey: "k", cities: ["Oslo"], maxPagesPerCity: 3, fetchImpl: pagedFetch(1, short) });
  assert.equal(short.length, 1);
  const capped: Array<{ pageToken?: string; fieldMask: string | null; textQuery: string }> = [];
  await discoverGooglePlacesCandidates({ apiKey: "k", cities: ["Oslo", "Bergen"], maxPagesPerCity: 10, fetchImpl: pagedFetch(9, capped) });
  assert.equal(capped.length, 6); // 2 cities x max 3 pages
});

test("requires a Google Maps Platform API key", async () => {
  await assert.rejects(
    () => discoverGooglePlacesCandidates({ apiKey: " " }),
    /GOOGLE_MAPS_API_KEY_MISSING/
  );
});

test("reports API failures with status and city", async () => {
  const fetchImpl: typeof fetch = async () => new Response("denied", { status: 403 });
  await assert.rejects(
    () => discoverGooglePlacesCandidates({ apiKey: "test-key", cities: ["Oslo"], fetchImpl }),
    /GOOGLE_PLACES_REQUEST_FAILED status=403 city=Oslo/
  );
});
