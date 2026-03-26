// server.js
import express from "express";
import cors from "cors";
import { info, debug, error } from "./logger.js";
import routes from "./routes/index.js";

const app = express();
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

const server = app.listen(PORT, "0.0.0.0", () => {
  info("🟩 AI Management Suite started on port " + PORT);
  debug("📡 Endpoints: /rss /script /tts /artwork /podcast /outreach /blog");
});

function shutdown(signal) {
  info("server.shutdown.start", { signal });

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

export default app;
