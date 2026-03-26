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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
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
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.use("/", routes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

app.use((err, _req, res, _next) => {
  error("server.unhandled", { error: err?.stack || String(err) });
  const message = err?.message === "CORS origin not allowed" ? err.message : "Internal error";
  const status = err?.message === "CORS origin not allowed" ? 403 : 500;
  res.status(status).json({ ok: false, error: message });
});

const PORT = process.env.PORT || 3000;
let server;

export function startServer(port = PORT, host = "0.0.0.0") {
  if (server?.listening) {
    return server;
  }

  server = app.listen(port, host, () => {
    info("🟩 AI Management Suite started on port " + port);
    debug("📡 Endpoints: /rss /script /tts /artwork /podcast /outreach /blog");
  });

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
    process.exit(0);
    return;
  }

  server.close((err) => {
    if (err) {
      error("server.shutdown.fail", { signal, error: err.message });
      process.exit(1);
    }

    info("server.shutdown.complete", { signal });
    process.exit(0);
  });

  setTimeout(() => {
    error("server.shutdown.force", { signal });
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  startServer();
}

export default app;
