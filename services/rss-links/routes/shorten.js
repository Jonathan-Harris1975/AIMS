// services/rss-links/routes/shorten.js
//
// POST /rss-links/shorten
// Body: { "url": "https://long-url.example.com/..." }
//
// Intended for internal calls from within the repo only.
// No CAPTCHA or auth layer — rely on network-level restriction.
//
// Returns: { ok: true, key: "AbC123", short_url: "https://…/rss-links/AbC123" }
//
import express from "express";
import { checkURL } from "../utils/checkURL.js";
import { randomString } from "../utils/randomString.js";
import { sha512 } from "../utils/sha512.js";
import { kvGet, kvPut } from "../store.js";
import { info, warn } from "../../../logger.js";

const router = express.Router();

/** Build the fully-qualified short URL returned to callers. */
function buildShortUrl(req, key) {
  // RSS_LINKS_BASE_URL is set once the service has its own custom domain.
  // Until then we fall back to the suite's own APP_URL.
  const base = (process.env.RSS_LINKS_BASE_URL || process.env.APP_URL || "")
    .replace(/\/$/, "");

  // When running under the suite the redirect lives at /rss-links/:key.
  // Once a custom domain is in place (and RSS_LINKS_BASE_URL is set to the
  // root of that domain) the path prefix is no longer needed — callers on
  // that domain should set RSS_LINKS_PATH_PREFIX="" in their environment.
  const prefix = process.env.RSS_LINKS_PATH_PREFIX !== undefined
    ? process.env.RSS_LINKS_PATH_PREFIX.replace(/\/$/, "")
    : "/rss-links";

  return base ? `${base}${prefix}/${key}` : `${prefix}/${key}`;
}

/**
 * Find or create a short key for a URL.
 * Uses SHA-512 as the dedup key when RSS_LINKS_UNIQUE=true (default).
 */
async function getOrCreateKey(url) {
  const unique = String(process.env.RSS_LINKS_UNIQUE ?? "true").toLowerCase() !== "false";

  if (unique) {
    const hash = sha512(url);
    const existing = kvGet(hash);
    if (existing) {
      return { key: existing, created: false };
    }
    const key = await generateUniqueKey();
    kvPut(key, url);
    kvPut(hash, key); // hash → key index for dedup
    return { key, created: true };
  }

  const key = await generateUniqueKey();
  kvPut(key, url);
  return { key, created: true };
}

/** Keep generating until we find a key not already in use. */
async function generateUniqueKey(attempts = 0) {
  if (attempts > 10) throw new Error("rss-links: failed to generate a unique key after 10 attempts");
  const key = randomString();
  if (kvGet(key) === null) return key;
  return generateUniqueKey(attempts + 1);
}

router.post("/", async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ ok: false, error: "Missing or invalid 'url' field" });
  }

  if (!checkURL(url)) {
    return res.status(400).json({ ok: false, error: "URL must be an absolute http/https URL" });
  }

  try {
    const { key, created } = await getOrCreateKey(url);
    const short_url = buildShortUrl(req, key);

    info("rss-links.shorten", { key, created, url });

    return res.status(created ? 201 : 200).json({ ok: true, key, short_url });
  } catch (err) {
    warn("rss-links.shorten.error", { error: err.message });
    return res.status(500).json({ ok: false, error: "Failed to create short link" });
  }
});

export default router;
