import test from "node:test";
import assert from "node:assert/strict";
import { discoverGooglePlacesCandidates } from "../src/integrations/google-places.js";

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
            { displayName: { text: "Eksempel Regnskap AS" }, websiteUri: "https://www.example.no", formattedAddress: "Oslo, Norway", googleMapsUri: "https://maps.google.com/example" },
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
  assert.equal(results.length, 2);
  assert.equal(results.find((item) => item.companyName === "Eksempel Regnskap AS")?.city, "Oslo");
  assert.equal(results.find((item) => item.companyName === "Eksempel Regnskap AS")?.websiteUrl, "https://www.example.no/");
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
