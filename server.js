import express from "express";

const app = express();

// ─────────────────────────────────────────────
// Health + root endpoints (used by Shiper)
// ─────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ─────────────────────────────────────────────
// Shiper uses a FIXED port defined in the UI
// ─────────────────────────────────────────────
const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on ${PORT}`);
});

// ─────────────────────────────────────────────
// Graceful shutdown (PaaS-safe)
// ─────────────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down");
  process.exit(0);
});
