import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

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

test.afterEach(() => {
  restoreEnv();
});

test("getSponsor maps a featured-book API payload to the existing outro contract", async () => {
  await withServer((req, res) => {
    if (req.url !== "/api/v1/featured-book.json") {
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
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.FEATURED_BOOK_API_URL = `${baseUrl}/api/v1/featured-book.json`;

    const mod = await import(`../services/script/utils/getSponsor.js?success=${Date.now()}`);
    const sponsor = await mod.default();

    assert.equal(sponsor.title, "AI in Agriculture: Revolutionizing Farming for a Sustainable Future");
    assert.equal(sponsor.url, "https://jonathan-harris.online/ebooks/agriculture/buy-now");
    assert.equal(sponsor.canonicalUrl, "https://jonathan-harris.online/ebooks/agriculture/");
    assert.equal(sponsor.buyUrl, "https://mybook.to/agriculture");
    assert.deepEqual(sponsor.tags, ["Agriculture", "Artificial Intelligence"]);
    assert.equal(sponsor.filter, "Agriculture");
    assert.equal(sponsor.selection.iso_week, 15);
    assert.equal(sponsor.podcastSponsor.headline, "This week's sponsor is AI in Agriculture");

    const { getOutroPromptFull } = await import(`../services/script/utils/promptTemplates.js?prompt=${Date.now()}`);
    const prompt = getOutroPromptFull(sponsor, { sessionId: "TT-test", date: "2026-04-09" });

    assert.match(prompt, /AI in Agriculture: Revolutionizing Farming for a Sustainable Future/);
    assert.match(prompt, /jonathan dash harris dot online slash ebooks slash agriculture slash buy dash now/);
  });
});

test("getSponsor falls back cleanly on HTTP error", async () => {
  await withServer((req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unavailable" }));
  }, async (baseUrl) => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.FEATURED_BOOK_API_URL = `${baseUrl}/api/v1/featured-book.json`;

    const mod = await import(`../services/script/utils/getSponsor.js?http=${Date.now()}`);
    const sponsor = await mod.default();

    assert.equal(sponsor.title, mod.FALLBACK_SPONSOR.title);
    assert.equal(sponsor.url, mod.FALLBACK_SPONSOR.url);
    assert.equal(sponsor.source, "fallback");
  });
});

test("getSponsor falls back cleanly on invalid featured-book payloads", async () => {
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
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.FEATURED_BOOK_API_URL = `${baseUrl}/api/v1/featured-book.json`;

    const mod = await import(`../services/script/utils/getSponsor.js?payload=${Date.now()}`);
    const sponsor = await mod.default();

    assert.equal(sponsor.title, mod.FALLBACK_SPONSOR.title);
    assert.equal(sponsor.url, mod.FALLBACK_SPONSOR.url);
    assert.equal(sponsor.source, "fallback");
  });
});

test("getSponsor falls back cleanly on malformed JSON", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"book": ');
  }, async (baseUrl) => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.FEATURED_BOOK_API_URL = `${baseUrl}/api/v1/featured-book.json`;

    const mod = await import(`../services/script/utils/getSponsor.js?json=${Date.now()}`);
    const sponsor = await mod.default();

    assert.equal(sponsor.title, mod.FALLBACK_SPONSOR.title);
    assert.equal(sponsor.url, mod.FALLBACK_SPONSOR.url);
    assert.equal(sponsor.source, "fallback");
  });
});
