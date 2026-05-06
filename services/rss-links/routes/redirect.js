// services/rss-links/routes/redirect.js
//
// GET /rss-links/:key
// Reads the R2-backed short-link record and issues a 302 redirect.

import express from "express";
import { getShortLinkRecord } from "../service.js";
import { debug, warn } from "../../../logger.js";

const router = express.Router();

function appendRequestQuery(target, query = {}) {
  const qs = new URLSearchParams(query).toString();
  if (!qs) return target;
  return `${target}${target.includes("?") ? "&" : "?"}${qs}`;
}

router.get("/:key", async (req, res) => {
  const { key } = req.params;

  try {
    const record = await getShortLinkRecord(key);

    if (!record?.originalUrl) {
      debug("rss-links.redirect.miss", { key });
      return res.status(404).json({ ok: false, error: "Short link not found", key });
    }

    const target = appendRequestQuery(record.originalUrl, req.query);

    debug("rss-links.redirect.hit", { key: record.key, target });
    return res.redirect(302, target);
  } catch (err) {
    warn("rss-links.redirect.error", { key, error: err?.message });
    return res.status(404).json({ ok: false, error: "Short link not found", key });
  }
});

export default router;
