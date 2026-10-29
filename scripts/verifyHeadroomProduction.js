import "../config/loadEnv.js";
// Deliberately spaced synthetic JSON gives the lossless compressor removable whitespace.
// No inference request is made; already-compact production input may legitimately be unchanged.
globalThis.__AI_PODCAST_LOGGER__ = { info() {}, warn() {}, error() {}, debug() {} };
try {
  if (!/^(true|1|yes|on|y)$/i.test(process.env.HEADROOM_ENABLED || "")) throw new Error("Headroom is disabled");
  const { compressForOpenRouter } = await import("../services/shared/utils/headroom.js");
  const rows = Array.from({ length: 120 }, (_, index) => JSON.stringify({
    id: index, status: "complete", category: "fixture", detail: "Repeated diagnostic context for compression verification", value: index % 7,
  }).replaceAll('":', '": ').replaceAll(',"', ', "'));
  const messages = [
    { role: "system", content: "Preserve this system instruction exactly. This is a synthetic compression check." },
    { role: "user", content: `Read this diagnostic table:\n${rows.join("\n")}` },
    { role: "assistant", content: "I have received the diagnostic context." },
    { role: "user", content: "Summarise the table. Preserve the latest instruction." },
  ];
  const result = await compressForOpenRouter({ routeName: "metadata", routeKey: "metadata", model: process.env.AI_MODEL_DEFAULT || "openai/gpt-5.6-luna", messages });
  if (!result.compressed || !(result.tokensSaved > 0)) {
    throw new Error(`Headroom did not demonstrate compression: ${result.reason || "no verified saving"}${result.status ? ` (HTTP ${result.status})` : ""}`);
  }
  if (result.messages.at(-1)?.content !== messages.at(-1).content) throw new Error("Headroom changed the protected latest instruction");
  console.log(JSON.stringify({ event: "headroom.production.verified", enabled: true, compressed: true,
    tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter, tokensSaved: result.tokensSaved }));
} catch (error) {
  console.error(JSON.stringify({ event: "headroom.production.unavailable", error: error.message }));
  process.exitCode = 1;
}
