import express from "express";

const app = express();

// ─────────────────────────────────────────────
// Health + root endpoints
// ─────────────────────────────────────────────
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// ─────────────────────────────────────────────
// Shiper uses a FIXED app port (from UI)
// NOT an injected PORT env variable
// ─────────────────────────────────────────────
const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on ${PORT}`);
});

// Graceful shutdown (optional but clean)
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received");
  process.exit(0);
});
