// server.js
import express from "express";
import cors from "cors";
import { info, debug, error } from "./logger.js";
import routes from "./routes/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health endpoints (Koyeb + Cloudflare)
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Mount all service routes at root
app.use("/", routes);

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

// Error handler
app.use((err, _req, res, _next) => {
  error("server.unhandled", { error: err?.stack || String(err) });
  res.status(500).json({ ok: false, error: "Internal error" });
});

// Koyeb requires process.env.PORT
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  info("🟩 AI Management Suite started on port " + PORT);
  debug("📡 Endpoints: /rss /script /tts /artwork /podcast /outreach");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  info("🛑 SIGTERM received, shutting down");
  process.exit(0);
});
