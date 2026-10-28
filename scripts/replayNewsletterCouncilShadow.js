// Explicit, read-only paid replay of previously exported private evidence records.
import { readFile, open } from "node:fs/promises";
import { qaFingerprint } from "../services/shared/utils/validatedResultCache.js";
import { compareCouncilShadow } from "../services/newsletter/engine/councilShadow.js";

if (!process.argv.includes("--run-models")) throw new Error("Paid replay requires --run-models; publication is never invoked");
const path = process.argv[2];
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
if (!path || path.startsWith("--") || !outputPath || outputPath.startsWith("--")) {
  throw new Error("Usage: node scripts/replayNewsletterCouncilShadow.js evidence.jsonl --run-models --out comparisons.jsonl");
}
const rows = (await readFile(path, "utf8")).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
if (!rows.length || rows.length > 50) throw new Error("Replay accepts 1-50 evidence records per invocation");
// Validate the entire bundle before buying any model calls.
const identities = new Set();
for (const row of rows) {
  if (!row.evidence?.newsletter || !row.evidence?.profile || !row.evidence?.lead || row.baseline?.attendance?.complete !== true) {
    throw new Error("Every replay case requires the original draft, source evidence, profile and complete baseline council");
  }
  const identity = qaFingerprint(row.evidence);
  if (identities.has(identity)) throw new Error("Duplicate replay evidence would buy the same work twice");
  identities.add(identity);
}
const output = await open(outputPath, "wx");
try { for (const [index, row] of rows.entries()) {
  const comparison = await compareCouncilShadow({ ...row.evidence, baseline: row.baseline, sessionId: `newsletter-shadow-replay-${index + 1}` });
  await output.write(`${JSON.stringify({ ...comparison, expectedBlocking: row.expectedBlocking ?? null,
    qualityDelta: row.qualityDelta ?? null, fullCostVerified: false })}\n`);
}

} finally { await output.close(); }
