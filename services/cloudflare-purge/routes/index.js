import express from "express";
import { info, error } from "../../../logger.js";
import {
  validateBody,
  cloudflarePurgeBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { purgeCloudflareCache, resolveCloudflarePurgeConfig } from "../utils/purgeCloudflareCache.js";
import { normaliseCloudflarePurgeRequestBody } from "../utils/purgeRequest.js";

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

function getPurgeAuthStrategy(req) {
  return req.aimsAuth?.strategy || "unauthenticated";
}

function getConfigHealth() {
  try {
    const config = resolveCloudflarePurgeConfig();
    return {
      configured: true,
      authMode: config.authMode,
      zoneEnvKey: config.zoneEnvKey,
      tokenEnvKey: config.tokenEnvKey || config.globalKeyEnvKey || null,
    };
  } catch (err) {
    return {
      configured: false,
      error: err?.message || String(err),
      envKey: err?.details?.envKey || null,
    };
  }
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cloudflare-purge",
    ...getConfigHealth(),
    time: new Date().toISOString(),
  });
});

router.post("/purge", asyncRoute(async (req, res) => {
  const normalisedBody = normaliseCloudflarePurgeRequestBody(req.body, req.query);
  const parsed = validateBody(cloudflarePurgeBodySchema, normalisedBody);
  if (!parsed.ok) {
    return res.status(400).json({
      ok: false,
      source: "aims-cloudflare-purge-validation",
      error: parsed.error,
      receivedKeys: req.body && typeof req.body === "object" && !Array.isArray(req.body) ? Object.keys(req.body) : [],
      normalisedKeys: Object.keys(normalisedBody),
    });
  }

  const payload = parsed.data;
  const mode = getPurgeMode(payload);

  info("cloudflare.purge.request", {
    mode,
    authStrategy: getPurgeAuthStrategy(req),
    counts: getPurgeCounts(payload),
    normalisedKeys: Object.keys(payload),
    requestId: req.id || req.headers["x-request-id"] || null,
  });

  try {
    const result = await purgeCloudflareCache(payload);

    info("cloudflare.purge.complete", {
      mode: result.mode,
      authMode: result.authMode,
      zoneEnvKey: result.zoneEnvKey,
      tokenEnvKey: result.tokenEnvKey,
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
      details: err?.details || null,
      error: err?.message || String(err),
    });

    return res.status(statusCode).json({
      ok: false,
      source: err?.details?.source || "cloudflare-purge-service",
      error: err?.message || "Cloudflare purge failed",
      details: err?.details || null,
    });
  }
}));

export default router;
