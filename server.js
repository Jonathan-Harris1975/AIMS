import express from "express";

const app = express();

/* ───────────────────────────────
   Health endpoints (Shiper probes)
─────────────────────────────── */
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

/* ───────────────────────────────
   PORT handling (MANDATORY)
─────────────────────────────── */
const PORT = process.env.PORT;

if (!PORT) {
  console.error("❌ PORT not provided by platform");
  process.exit(1); // force Shiper to retry with env injected
}

/* ───────────────────────────────
   Start server (bind to all IFs)
─────────────────────────────── */
app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 Server listening on ${PORT}`);
});

/* ───────────────────────────────
   Graceful shutdown (PaaS-safe)
─────────────────────────────── */
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down");
  process.exit(0);
});
