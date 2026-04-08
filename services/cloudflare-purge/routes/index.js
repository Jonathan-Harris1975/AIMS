import express from "express";
import { info, error } from "../../../logger.js";
import {
  validateBody,
  cloudflarePurgeBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { purgeCloudflareCache } from "../utils/purgeCloudflareCache.js";

const router = express.Router();

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getPurgeMode(body = {}) {
  if (body?.purge_everything === true) return "purge_everything";
  if (Array.isArray(body?.files)) return "files";
  if (Array.isArray(body?.tags)) return "tags";
  if (Array.isArray(body?.hosts)) return "hosts";
  if (Array.isArray(body?.prefixes)) return "prefixes";
  return "invalid";
}

function getPurgeCounts(body = {}) {
  return {
    files: Array.isArray(body.files) ? body.files.length : 0,
    tags: Array.isArray(body.tags) ? body.tags.length : 0,
    hosts: Array.isArray(body.hosts) ? body.hosts.length : 0,
    prefixes: Array.isArray(body.prefixes) ? body.prefixes.length : 0,
  };
}

function getConfiguredSharedSecret() {
  return String(process.env.CLOUDFLARE_PURGE_SHARED_SECRET || "").trim();
}

function requirePurgeSecret(req, res) {
  const configuredSecret = getConfiguredSharedSecret();
  if (!configuredSecret) {
    return true;
  }

  const providedSecret = String(req.get("x-cloudflare-purge-secret") || "").trim();
  if (!providedSecret) {
    res.status(401).json({
      ok: false,
      error: "Missing Cloudflare purge secret.",
    });
    return false;
  }

  if (providedSecret !== configuredSecret) {
    res.status(403).json({
      ok: false,
      error: "Invalid Cloudflare purge secret.",
    });
    return false;
  }

  return true;
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cloudflare-purge",
    configured: Boolean(String(process.env.CF_zone || "").trim() && String(process.env.CF_purge || "").trim()),
    time: new Date().toISOString(),
  });
});

router.post("/purge", asyncRoute(async (req, res) => {
  if (!requirePurgeSecret(req, res)) {
    return;
  }

  const parsed = validateBody(cloudflarePurgeBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const payload = parsed.data;
  const mode = getPurgeMode(payload);

  info("cloudflare.purge.request", {
    mode,
    counts: getPurgeCounts(payload),
    requestId: req.id || req.headers["x-request-id"] || null,
  });

  try {
    const result = await purgeCloudflareCache(payload);

    info("cloudflare.purge.complete", {
      mode: result.mode,
      requestId: result.result?.id || null,
    });

    return res.json({
      ok: true,
      service: "cloudflare-purge",
      ...result,
    });
  } catch (err) {
    const statusCode = err?.statusCode || err?.status || 500;

    error("cloudflare.purge.fail", {
      mode,
      statusCode,
      error: err?.message || String(err),
    });

    return res.status(statusCode).json({
      ok: false,
      error: err?.message || "Cloudflare purge failed",
    });
  }
}));

export default router;
