import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import getSponsor from "../services/script/utils/getSponsor.js";
import { getOutroPromptFull } from "../services/script/utils/promptTemplates.js";

const FEATURED_BOOK_PATH = "/api/v1/featured-book.json";
const EXPECTED_FALLBACK = {
  title: "Digital Diagnosis: How AI Is Revolutionizing Healthcare",
  url: "https://jonathan-harris.online",
};

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("getSponsor maps a featured-book API payload to the existing outro contract", { concurrency: false }, async () => {
  await withServer((req, res) => {
    if (req.url !== FEATURED_BOOK_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      version: "v1",
      selection: { method: "iso_week_rotation", iso_week: 15, year: 2026 },
      book: {
        title: "AI in Agriculture: Revolutionizing Farming for a Sustainable Future",
        canonical_url: "https://jonathan-harris.online/ebooks/agriculture/",
        buy_url: "https://mybook.to/agriculture",
        buy_route_full: "https://jonathan-harris.online/ebooks/agriculture/buy-now",
        short: "A plain-English guide to AI in agriculture.",
        tags: ["Agriculture", "Artificial Intelligence"],
        filter: "Agriculture"
      },
      podcast_sponsor: {
        label: "This week's sponsor",
        headline: "This week's sponsor is AI in Agriculture",
        cta: "Buy now",
        midroll_15: "Sponsor copy",
        midroll_30: "Longer sponsor copy"
      }
    }));
  }, async (baseUrl) => {
    const sponsor = await getSponsor({
      apiUrl: `${baseUrl}${FEATURED_BOOK_PATH}`,
      timeout: 2_000,
    });

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
});

test("getSponsor falls back cleanly on HTTP error", { concurrency: false }, async () => {
  await withServer((req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unavailable" }));
  }, async (baseUrl) => {
    const sponsor = await getSponsor({
      apiUrl: `${baseUrl}${FEATURED_BOOK_PATH}`,
      timeout: 2_000,
    });

    assert.equal(sponsor.title, EXPECTED_FALLBACK.title);
    assert.equal(sponsor.url, EXPECTED_FALLBACK.url);
    assert.equal(sponsor.source, "fallback");
  });
});

test("getSponsor falls back cleanly on invalid featured-book payloads", { concurrency: false }, async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      version: "v1",
      selection: { method: "iso_week_rotation", iso_week: 15, year: 2026 },
      book: {
        canonical_url: "https://jonathan-harris.online/ebooks/agriculture/"
      }
    }));
  }, async (baseUrl) => {
    const sponsor = await getSponsor({
      apiUrl: `${baseUrl}${FEATURED_BOOK_PATH}`,
      timeout: 2_000,
    });

    assert.equal(sponsor.title, EXPECTED_FALLBACK.title);
    assert.equal(sponsor.url, EXPECTED_FALLBACK.url);
    assert.equal(sponsor.source, "fallback");
  });
});

test("getSponsor falls back cleanly on malformed JSON", { concurrency: false }, async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"book": ');
  }, async (baseUrl) => {
    const sponsor = await getSponsor({
      apiUrl: `${baseUrl}${FEATURED_BOOK_PATH}`,
      timeout: 2_000,
    });

    assert.equal(sponsor.title, EXPECTED_FALLBACK.title);
    assert.equal(sponsor.url, EXPECTED_FALLBACK.url);
    assert.equal(sponsor.source, "fallback");
  });
});
