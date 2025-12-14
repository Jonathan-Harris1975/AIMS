// server.js
import express from "express";
import cors from "cors";
import { info, debug } from "#logger.js";
import routes from "./routes/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health endpoints (Koyeb + Cloudflare)
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Mount all application routes
app.use("/", routes);

// Koyeb requires process.env.PORT
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  info("🟩 AI Podcast Suite started on port " + PORT);
  debug("📡 Endpoints: RSS, Script, TTS, Artwork, Podcast Pipeline");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  info("🛑 SIGTERM received, shutting down");
  process.exit(0);
});
