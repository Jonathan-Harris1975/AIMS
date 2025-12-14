import express from "express";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on ${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received");
  process.exit(0);
});
