// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import pinoHttp from "pino-http";
import { info, debug, error, log } from "./logger.js";
import routes from "./routes/index.js";
import { fileURLToPath } from "node:url";

export const app = express();

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === "") {
    return process.env.NODE_ENV === "production" ? 1 : false;
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

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
app.set("trust proxy", trustProxy);

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== "production" && allowedOrigins.length === 0) {
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

app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) =>
  res.status(200).json({ status: "ok", trustProxy })
);

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

  const message = err?.message === "CORS origin not allowed" ? err.message : "Internal error";
  const status = err?.message === "CORS origin not allowed" ? 403 : 500;
  res.status(status).json({ ok: false, error: message, requestId });
});

const PORT = process.env.PORT || 3000;
let server;
let processHandlersBound = false;

export function startServer(port = PORT, host = "0.0.0.0") {
  if (server?.listening) {
    return server;
  }

  server = app.listen(port, host, () => {
    info("🟩 AI Management Suite started on port " + port);
    debug("📡 Endpoints: /rss /script /tts /artwork /podcast /outreach /blog");
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
