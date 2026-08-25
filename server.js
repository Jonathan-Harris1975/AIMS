import "./config/loadEnv.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import pinoHttp from "pino-http";
import { info, debug, error, log } from "./logger.js";
import routes from "./routes/index.js";
import { fileURLToPath } from "node:url";
import { createRateLimitMiddleware } from "./services/shared/middleware/rateLimit.js";
import { parseTrustProxy } from "./services/shared/http/trustProxy.js";
import { hasDurableStateEnv, durableStateEnvHint } from "./services/shared/utils/durableStateEnv.js";
import * as lifecycle from "./services/shared/utils/lifecycle.js";
import { requireAimsBearerAuth } from "./services/shared/middleware/suiteAuth.js";
import { getCommsHubReadiness } from "./services/comms-hub/config.js";
import { getCommsHubRuntimeReadiness, startCommsHubRuntime, stopCommsHubRuntime } from "./services/comms-hub/runtime.js";
import { restoreAimsModelGovernance } from "./services/shared/utils/modelGovernance.js";
import { probeCriticalDependencies } from "./services/shared/readiness/dependencyProbes.js";

const require = createRequire(import.meta.url);
const PACKAGE_VERSION = require("./package.json")?.version || "unknown";

export const app = express();

function normaliseEnvString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isProductionEnv() {
  return normaliseEnvString(process.env.NODE_ENV).toLowerCase() === "production";
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isCorsDeniedError(err) {
  return err?.message === "CORS origin not allowed";
}

function normaliseErrorStatus(err) {
  const status = Number(err?.statusCode || err?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function publicErrorMessage(err, status) {
  if (isCorsDeniedError(err)) return err.message;
  if (status === 500) return "Internal error";
  return err?.message || "Request failed";
}


function isNoisyProbePath(value) {
  const rawPath = String(value || "").split("?")[0].toLowerCase();
  const path = rawPath.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";

  if (
    /(?:^|\/)(?:\.git\/config|xmlrpc\.php|wp-admin|wp-content|wp-includes|wlwmanifest\.xml|wordpress|cms|wp)(?:[\/?#]|$)/i.test(path)
  ) {
    return true;
  }

  /*
   * Public Koyeb services attract automated probes for framework config,
   * CI files, local editor folders, private keys and logs. These are not AIMS
   * routes, so reject them before pino-http and the rate limiter to avoid
   * noisy 401/429 log bursts.
   */
  if (
    /^(?:\/(?:config|internal|private|deploy|settings|core|project)(?:\/|$))/.test(path) ||
    /^(?:\/(?:app|application|system)\/config(?:\/|$))/.test(path) ||
    /^(?:\/(?:storage\/logs|logs?|bootstrap\/cache)(?:\/|$))/.test(path) ||
    /^(?:\/(?:web-inf|meta-inf)(?:\/|$))/.test(path) ||
    /^(?:\/(?:\.idea|\.vscode|\.circleci|\.github|\.buildkite)(?:\/|$))/.test(path) ||
    /^\/(?:\.gitlab-ci\.ya?ml|\.travis\.yml|\.drone\.ya?ml|azure-pipelines\.yml|bitbucket-pipelines\.yml|jenkinsfile|jenkins\/jenkinsfile)$/.test(path) ||
    /^\/(?:debug|app|application|error|laravel|server|access|trace)\.log$/.test(path) ||
    /^\/(?:web\.config|nginx\.conf|nginx\.config|server\.xml|local-config\.php|wp-config\.(?:bak|txt))$/.test(path) ||
    /^\/(?:\.htpasswd|\.htaccess|\.gitconfig|\.netrc|\.npmrc|\.bash_history|\.pypirc|id_rsa|private\.key|private_key\.pem|server\.pem|server\.key)(?:\/|$)/.test(path) ||
    /^\/\.ssh(?:\/|$)/.test(path)
  ) {
    return true;
  }

  return false;
}

function isQuietAccessLogRequest(req) {
  const method = String(req?.method || "").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) return false;

  const path = String(req?.originalUrl || req?.url || req?.path || "/")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";

  return path === "/" || path === "/health" || path.toLowerCase().endsWith("/health");
}

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
app.set("trust proxy", trustProxy);

/*
 * Silence repetitive ACME challenge probes before they hit:
 * - CORS
 * - body parsers
 * - pino-http
 * - rate limiting
 *
 * This keeps runtime waste and log spam down.
 */
app.use("/.well-known/acme-challenge", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.status(204).end();
});

/*
 * Silence repetitive scanner/browser noise before it hits:
 * - CORS
 * - body parsers
 * - pino-http
 * - rate limiting
 *
 * Koyeb receives public internet traffic. These paths are common bot probes,
 * not app routes. Returning before pino keeps production logs useful.
 */
app.use((req, res, next) => {
  const requestPath = req.originalUrl || req.url || "";

  if (requestPath === "/favicon.ico") {
    res.set("Cache-Control", "public, max-age=86400");
    return res.redirect(308, "https://assets.jonathan-harris.online/favicon.ico");
  }

  if (requestPath === "/robots.txt") {
    res.type("text/plain");
    res.set("Cache-Control", "public, max-age=86400");
    return res.status(204).end();
  }

  if (isNoisyProbePath(requestPath)) {
    res.set("Cache-Control", "no-store");
    return res.status(404).end();
  }

  return next();
});

app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  next();
});

function usableSecret(value) {
  const text = normaliseEnvString(value);
  return Boolean(text && !/^\{\{\s*secret\.[^}]+\}\}$/i.test(text));
}

async function productionReadiness() {
  const production = isProductionEnv();
  const ephemeralAllowed = process.env.ALLOW_EPHEMERAL_STATE === "true";
  const durableConfigured = hasDurableStateEnv(process.env);
  const openrouterConfigured = usableSecret(process.env.OPENROUTER_API_KEY);
  const probes = production
    ? await probeCriticalDependencies()
    : {
        durableState: { ok: durableConfigured, configured: durableConfigured, detail: durableConfigured ? "configured" : "missing" },
        openrouter: { ok: openrouterConfigured, configured: openrouterConfigured, detail: openrouterConfigured ? "configured" : "missing" },
      };
  const checks = [
    { name: "process", ok: true, detail: "AIMS process is responding." },
    { name: "suite_auth", ok: !production || usableSecret(process.env.AIMS_API_KEY || process.env.AI_SUITE_API_KEY), detail: usableSecret(process.env.AIMS_API_KEY || process.env.AI_SUITE_API_KEY) ? "configured" : "missing" },
    {
      name: "durable_state",
      ok: !production || ephemeralAllowed || (durableConfigured && probes.durableState.ok),
      detail: durableConfigured
        ? `R2 durable state ${probes.durableState.detail}`
        : `ephemeral or incomplete durable state configuration. ${durableStateEnvHint()}`,
    },
    {
      name: "openrouter",
      ok: !production || (openrouterConfigured && probes.openrouter.ok),
      detail: openrouterConfigured ? probes.openrouter.detail : "missing",
    },
    (() => {
      const configuration = getCommsHubReadiness();
      const runtime = getCommsHubRuntimeReadiness();
      return {
        name: "comms_hub",
        ok: configuration.ready && runtime.ready,
        detail: runtime.status,
      };
    })(),
  ];
  const ready = checks.every((check) => check.ok);
  return { ready, status: ready ? "ready" : "degraded", checks };
}

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function commsHubIntakePath(req) {
  const method = String(req?.method || "").toUpperCase();
  if (method !== "POST") return "";
  const path = String(req?.originalUrl || req?.url || "")
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
  return [
    "/comms-hub/intake/jotform",
    "/comms-hub/intake/zernio/meta",
    "/comms-hub/intake/zernio/video",
    "/comms-hub/intake/chat",
    "/comms-hub/intake/chat/sync",
  ].includes(path) ? path : "";
}

function recordCommsHubParsedBodyBytes(req, _res, buffer) {
  const path = commsHubIntakePath(req);
  if (!path) return;
  const bytes = Buffer.isBuffer(buffer) ? buffer.length : 0;
  const configured = Number(process.env.COMMS_HUB_MAX_WEBHOOK_BYTES || 1_048_576);
  const maximum = Number.isInteger(configured) && configured > 0 ? configured : 1_048_576;
  if (bytes > maximum) {
    const error = new Error("Comms Hub webhook body exceeds the configured size limit.");
    error.status = 413;
    error.statusCode = 413;
    error.type = "entity.too.large";
    throw error;
  }
  req.aimsParsedBodyBytes = bytes;
  if (path.startsWith("/comms-hub/intake/zernio/") || path.startsWith("/comms-hub/intake/chat")) req.aimsRawBody = Buffer.from(buffer);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProductionEnv() && allowedOrigins.length === 0 && isLoopbackOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin not allowed"));
    },
  })
);

app.use(
  pinoHttp({
    logger: log,
    quietReqLogger: true,
    autoLogging: {
      ignore: isQuietAccessLogRequest,
    },
    genReqId(req, res) {
      const inherited =
        req.headers["x-request-id"] ||
        req.headers["x-trigger-run-key"] ||
        req.headers["x-idempotency-key"];

      const requestId =
        typeof inherited === "string" && inherited.trim()
          ? inherited.trim()
          : crypto.randomUUID();

      res.setHeader("x-request-id", requestId);
      return requestId;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.ip,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  })
);

app.use((req, res, next) => {
  lifecycle.requestStarted();
  let requestSettled = false;
  const finishRequest = () => {
    if (requestSettled) return;
    requestSettled = true;
    lifecycle.requestFinished();
  };
  res.once("finish", finishRequest);
  res.once("close", finishRequest);
  next();
});

/*
 * Reject abusive and unauthorised traffic before consuming request bodies.
 * Public Comms Hub intake routes are still authenticated by their route-level
 * webhook signatures after the bounded parser has preserved the raw body.
 */
app.use(createRateLimitMiddleware());
app.use(requireAimsBearerAuth);

const commsHubMaxWebhookBytes = (() => {
  const configured = Number(process.env.COMMS_HUB_MAX_WEBHOOK_BYTES || 1_048_576);
  return Number.isInteger(configured) && configured > 0 ? configured : 1_048_576;
})();

function isJsonRequest(req) {
  return Boolean(req.is?.(["application/json", "application/*+json"]));
}

function isUrlEncodedRequest(req) {
  return Boolean(req.is?.("application/x-www-form-urlencoded"));
}

/*
 * Comms Hub public intake uses its own strict parser ceiling. This makes the
 * one-megabyte webhook contract effective while the stream is being read,
 * including when Content-Length is absent. Multipart Jotform bodies bypass
 * these parsers and are bounded by readJotformWebhookEnvelope's stream reader.
 */
app.use(express.json({
  limit: commsHubMaxWebhookBytes,
  type: (req) => Boolean(commsHubIntakePath(req)) && isJsonRequest(req),
  verify: recordCommsHubParsedBodyBytes,
}));
app.use(express.urlencoded({
  extended: true,
  limit: commsHubMaxWebhookBytes,
  type: (req) => Boolean(commsHubIntakePath(req)) && isUrlEncodedRequest(req),
  verify: recordCommsHubParsedBodyBytes,
}));

/* General authenticated API bodies retain the existing configurable ceiling. */
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "10mb",
  type: (req) => !commsHubIntakePath(req) && isJsonRequest(req),
}));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.URLENCODED_BODY_LIMIT || "10mb",
  type: (req) => !commsHubIntakePath(req) && isUrlEncodedRequest(req),
}));

app.get("/", (_req, res) => res.status(200).send("OK"));

app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    status: "ok",
    service: "AIMS",
    version: process.env.APP_VERSION || PACKAGE_VERSION,
    env: process.env.APP_ENV || process.env.NODE_ENV || "development",
    trustProxy,
    time: new Date().toISOString(),
    lifecycle: lifecycle.computeState({ dependenciesReady: true }),
  })
);

app.get("/livez", (_req, res) =>
  res.status(200).json({ ok: true, status: "alive", service: "AIMS", lifecycle: lifecycle.snapshot() })
);

app.get("/readyz", async (_req, res, next) => {
  try {
    const report = await productionReadiness();
    const lifecycleState = lifecycle.computeState({ dependenciesReady: report.ready });
    return res.status(report.ready && lifecycleState.state !== "maintenance" ? 200 : 503).json({
      ok: report.ready,
      service: "AIMS",
      version: process.env.APP_VERSION || PACKAGE_VERSION,
      ...report,
      lifecycle: lifecycleState,
      time: new Date().toISOString(),
    });
  } catch (readinessError) {
    return next(readinessError);
  }
});

app.get("/admin/lifecycle", requireAimsBearerAuth, (_req, res) => res.status(200).json(lifecycle.snapshot()));

app.post("/admin/lifecycle/maintenance", requireAimsBearerAuth, (req, res) => {
  const on = Boolean(req.body?.on);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : undefined;
  const snapshot = on ? lifecycle.enterMaintenance(reason) : lifecycle.exitMaintenance(reason);
  return res.status(200).json(snapshot);
});

app.use("/", routes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

app.use((err, req, res, _next) => {
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      ok: false,
      error: "Invalid JSON body",
      requestId,
    });
  }

  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      ok: false,
      error: "Request body too large",
      requestId,
    });
  }

  if (err?.type === "request.aborted") {
    return res.status(400).json({
      ok: false,
      error: "Request aborted before body was fully received",
      requestId,
    });
  }

  error("server.unhandled", {
    requestId,
    error: err?.stack || String(err),
  });

  const status = isCorsDeniedError(err) ? 403 : normaliseErrorStatus(err);
  const message = publicErrorMessage(err, status);

  res.status(status).json({
    ok: false,
    error: message,
    requestId,
    ...(status < 500 && Array.isArray(err?.availableCategories)
      ? { availableCategories: err.availableCategories }
      : {}),
  });
});

const PORT = process.env.PORT || 3000;
let server;
let processHandlersBound = false;

export function startServer(port = PORT, host = "0.0.0.0") {
  if (server?.listening) {
    return server;
  }

  server = app.listen(port, host, () => {
    info("AI Management Suite started", { port, host });
    debug("server.endpoints", {
      endpoints: [
        "/rss",
        "/script",
        "/tts",
        "/artwork",
        "/podcast",
        "/outreach",
        "/blog",
        "/cloudflare",
        "/zernio",
        "/audits",
        "/comms-hub",
      ],
    });
    debug("server.trustProxy", { trustProxy });
  });

  void restoreAimsModelGovernance()
    .catch((err) => error("model-governance.aims.startup-restore", { error: err?.message || String(err) }));
  void startCommsHubRuntime();

  if (!processHandlersBound) {
    processHandlersBound = true;

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
      error("server.unhandledRejection", {
        error: reason instanceof Error ? reason.stack || reason.message : String(reason),
      });
    });

    process.on("uncaughtException", (err) => {
      error("server.uncaughtException", {
        error: err?.stack || err?.message || String(err),
      });
      shutdown("uncaughtException");
    });
  }

  return server;
}

export async function stopServer() {
  if (!server) return;

  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  await stopCommsHubRuntime();
  server = undefined;
}

function shutdown(signal) {
  info("server.shutdown.start", { signal });

  if (!server) {
    info("server.shutdown.complete", { signal, note: "server_not_running" });
    process.exit(signal === "uncaughtException" ? 1 : 0);
    return;
  }

  server.close((err) => {
    if (err) {
      error("server.shutdown.fail", { signal, error: err.message });
      process.exit(1);
      return;
    }

    void stopCommsHubRuntime()
      .catch((runtimeError) => {
        error("commsHub.runtime.stopFailed", { signal, error: runtimeError?.message || String(runtimeError) });
      })
      .finally(() => {
        info("server.shutdown.complete", { signal });
        process.exit(signal === "uncaughtException" ? 1 : 0);
      });
  });

  setTimeout(() => {
    error("server.shutdown.force", { signal });
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 25000).unref();
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  startServer();
}

export default app;
