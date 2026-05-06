// services/rss-links/routes/shorten.js
//
// POST /rss-links/shorten
// Body: { "url": "https://long-url.example.com/..." }
//
// Returns: { ok: true, key, short_url, original_url, created }

import express from "express";
import { createShortLink } from "../service.js";
import { info, warn } from "../../../logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ ok: false, error: "Missing or invalid 'url' field" });
  }

  try {
    const result = await createShortLink(url);

    info("rss-links.shorten", {
      key: result.key,
      created: result.created,
      originalUrl: result.originalUrl,
    });

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      key: result.key,
      short_url: result.shortUrl,
      original_url: result.originalUrl,
      created: result.created,
    });
  } catch (err) {
    const message = err?.message || "Failed to create short link";
    const isBadUrl = /URL must be an absolute http\/https URL/i.test(message);

    warn("rss-links.shorten.error", { error: message });

    return res.status(isBadUrl ? 400 : 500).json({
      ok: false,
      error: isBadUrl ? message : "Failed to create short link",
    });
  }
});

export default router;
