// services/rss-links/routes/redirect.js
//
// GET /rss-links/:key
// Looks up the short key and issues a 302 redirect to the target URL.
// Returns 404 if the key does not exist.
//
import express from "express";
import { kvGet } from "../store.js";
import { debug } from "../../../logger.js";

const router = express.Router();

router.get("/:key", (req, res) => {
  const { key } = req.params;
  const target = kvGet(key);

  if (!target) {
    debug("rss-links.redirect.miss", { key });
    return res.status(404).json({ ok: false, error: "Short link not found", key });
  }

  // Preserve any query string the caller appended to the short URL.
  const qs = Object.keys(req.query).length
    ? "?" + new URLSearchParams(req.query).toString()
    : "";

  debug("rss-links.redirect.hit", { key, target });
  return res.redirect(302, target + qs);
});

export default router;
