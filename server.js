import "./config/loadEnv.js";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import pinoHttp from "pino-http";
import { info, debug, error, log } from "./logger.js";
import routes from "./routes/index.js";
import { fileURLToPath } from "node:url";
import { createRateLimitMiddleware } from "./services/shared/middleware/rateLimit.js";

export const app = express();

function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isProductionEnv(value = process.env.NODE_ENV) {
  return normaliseEnvString(value).toLowerCase() === "production";
}

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === "") {
    return isProductionEnv() ? 1 : false;
  }

  if (value === true || value === false) {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value;
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

function productionReadiness() {
  const production = isProductionEnv();
  const checks = [
    { name: "process", ok: true, detail: "AIMS process is responding." },
    { name: "suite_auth", ok: !production || usableSecret(process.env.AIMS_API_KEY || process.env.ADMIN_BEARER_TOKEN), detail: usableSecret(process.env.AIMS_API_KEY || process.env.ADMIN_BEARER_TOKEN) ? "configured" : "missing" },
    {
      name: "durable_state",
      ok:
        !production ||
        process.env.ALLOW_EPHEMERAL_STATE === "true" ||
        (usableSecret(process.env.R2_ACCESS_KEY_ID) &&
          usableSecret(process.env.R2_SECRET_ACCESS_KEY) &&
          Boolean(normaliseEnvString(process.env.R2_BUCKET_META_SYSTEM || process.env.R2_META_SYSTEM_BUCKET || process.env.R2_BUCKET_METASYSTEM))),
      detail:
        usableSecret(process.env.R2_ACCESS_KEY_ID) && usableSecret(process.env.R2_SECRET_ACCESS_KEY)
          ? "R2 credentials configured"
          : "ephemeral or incomplete R2 configuration",
    },
    { name: "openrouter", ok: !production || usableSecret(process.env.OPENROUTER_API_KEY), detail: usableSecret(process.env.OPENROUTER_API_KEY) ? "configured" : "missing" },
  ];
  const ready = checks.every((check) => check.ok);
  return { ready, status: ready ? "ready" : "degraded", checks };
}

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "10mb" }));

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
        req.headers["x-hookdeck-eventid"] ||
        req.headers["x-hookdeck-event-id"];

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

app.use(createRateLimitMiddleware());

app.get("/", (_req, res) => res.status(200).send("OK"));

app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    status: "ok",
    service: "AIMS",
    version: process.env.APP_VERSION || "2.7.1",
    env: process.env.APP_ENV || process.env.NODE_ENV || "development",
    trustProxy,
    time: new Date().toISOString(),
  })
);

app.get("/livez", (_req, res) =>
  res.status(200).json({ ok: true, status: "alive", service: "AIMS" })
);

app.get("/readyz", (_req, res) => {
  const report = productionReadiness();
  return res.status(report.ready ? 200 : 503).json({
    ok: report.ready,
    service: "AIMS",
    version: process.env.APP_VERSION || "2.7.1",
    ...report,
    time: new Date().toISOString(),
  });
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
        "/oneup",
        "/audits",
      ],
    });
    debug("server.trustProxy", { trustProxy });
  });

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
    }

    info("server.shutdown.complete", { signal });
    process.exit(signal === "uncaughtException" ? 1 : 0);
  });

  setTimeout(() => {
    error("server.shutdown.force", { signal });
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000).unref();
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  startServer();
}

export default app;
