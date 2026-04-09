import test from "node:test";
import assert from "node:assert/strict";

import getSponsor from "../services/script/utils/getSponsor.js";
import { getOutroPromptFull } from "../services/script/utils/promptTemplates.js";

const FEATURED_BOOK_API_URL = "https://example.test/api/v1/featured-book.json";
const EXPECTED_FALLBACK = {
  title: "Digital Diagnosis: How AI Is Revolutionizing Healthcare",
  url: "https://jonathan-harris.online",
};

function createResponse({ ok = true, status = 200, body = "" } = {}) {
  return {
    ok,
    status,
    async text() {
      return body;
    },
  };
}

test("getSponsor maps a featured-book API payload to the existing outro contract", async () => {
  let capturedUrl = null;
  let capturedOptions = null;

  const sponsor = await getSponsor({
    apiUrl: FEATURED_BOOK_API_URL,
    timeout: 2_000,
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;

      return createResponse({
        ok: true,
        status: 200,
        body: JSON.stringify({
          version: "v1",
          selection: { method: "iso_week_rotation", iso_week: 15, year: 2026 },
          book: {
            title: "AI in Agriculture: Revolutionizing Farming for a Sustainable Future",
            canonical_url: "https://jonathan-harris.online/ebooks/agriculture/",
            buy_url: "https://mybook.to/agriculture",
            buy_route_full: "https://jonathan-harris.online/ebooks/agriculture/buy-now",
            short: "A plain-English guide to AI in agriculture.",
            tags: ["Agriculture", "Artificial Intelligence"],
            filter: "Agriculture",
          },
          podcast_sponsor: {
            label: "This week's sponsor",
            headline: "This week's sponsor is AI in Agriculture",
            cta: "Buy now",
            midroll_15: "Sponsor copy",
            midroll_30: "Longer sponsor copy",
          },
        }),
      });
    },
  });

  assert.equal(capturedUrl, FEATURED_BOOK_API_URL);
  assert.equal(capturedOptions.method, "GET");
  assert.equal(capturedOptions.timeout, 2_000);
  assert.deepEqual(capturedOptions.headers, { accept: "application/json" });

  assert.equal(sponsor.title, "AI in Agriculture: Revolutionizing Farming for a Sustainable Future");
  assert.equal(sponsor.url, "https://jonathan-harris.online/ebooks/agriculture/buy-now");
  assert.equal(sponsor.canonicalUrl, "https://jonathan-harris.online/ebooks/agriculture/");
  assert.equal(sponsor.buyUrl, "https://mybook.to/agriculture");
  assert.deepEqual(sponsor.tags, ["Agriculture", "Artificial Intelligence"]);
  assert.equal(sponsor.filter, "Agriculture");
  assert.equal(sponsor.selection.iso_week, 15);
  assert.equal(sponsor.podcastSponsor.headline, "This week's sponsor is AI in Agriculture");

  const prompt = getOutroPromptFull(sponsor, { sessionId: "TT-test", date: "2026-04-09" });

  assert.match(prompt, /AI in Agriculture: Revolutionizing Farming for a Sustainable Future/);
  assert.match(prompt, /jonathan dash harris dot online slash ebooks slash agriculture slash buy dash now/);
});

test("getSponsor falls back cleanly on HTTP error", async () => {
  const sponsor = await getSponsor({
    apiUrl: FEATURED_BOOK_API_URL,
    timeout: 2_000,
    fetchImpl: async () => createResponse({
      ok: false,
      status: 503,
      body: JSON.stringify({ error: "unavailable" }),
    }),
  });

  assert.equal(sponsor.title, EXPECTED_FALLBACK.title);
  assert.equal(sponsor.url, EXPECTED_FALLBACK.url);
  assert.equal(sponsor.source, "fallback");
});

test("getSponsor falls back cleanly on invalid featured-book payloads", async () => {
  const sponsor = await getSponsor({
    apiUrl: FEATURED_BOOK_API_URL,
    timeout: 2_000,
    fetchImpl: async () => createResponse({
      ok: true,
      status: 200,
      body: JSON.stringify({
        version: "v1",
        selection: { method: "iso_week_rotation", iso_week: 15, year: 2026 },
        book: {
          canonical_url: "https://jonathan-harris.online/ebooks/agriculture/",
        },
      }),
    }),
  });

  assert.equal(sponsor.title, EXPECTED_FALLBACK.title);
  assert.equal(sponsor.url, EXPECTED_FALLBACK.url);
  assert.equal(sponsor.source, "fallback");
});

test("getSponsor falls back cleanly on malformed JSON", async () => {
  const sponsor = await getSponsor({
    apiUrl: FEATURED_BOOK_API_URL,
    timeout: 2_000,
    fetchImpl: async () => createResponse({
      ok: true,
      status: 200,
      body: '{"book": ',
    }),
  });

  assert.equal(sponsor.title, EXPECTED_FALLBACK.title);
  assert.equal(sponsor.url, EXPECTED_FALLBACK.url);
  assert.equal(sponsor.source, "fallback");
});
