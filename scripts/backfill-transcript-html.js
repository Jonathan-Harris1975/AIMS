// ============================================================
// scripts/backfill-transcript-html.js
// ONE-TIME backfill: generates HTML transcript pages for all
// existing episodes in the transcript R2 bucket.
//
// Run from repo root:
//   node scripts/backfill-transcript-html.js
//
// Requires env vars (loaded via dotenv):
//   R2_BUCKET_TRANSCRIPTS, R2_PUBLIC_BASE_URL_TRANSCRIPT,
//   R2_BUCKET_META (or equivalent), plus AWS/R2 credentials.
// ============================================================

import "dotenv/config";
import {
  listKeys,
  getObjectAsText,
  uploadText,
} from "../services/shared/utils/r2-client.js";
import { generateTranscriptHtml } from "../services/script/utils/generateTranscriptHtml.js";

const TRANSCRIPT_BUCKET = "transcript";
const META_BUCKET       = "meta";
const DRY_RUN           = process.argv.includes("--dry-run");

// ── helpers ──────────────────────────────────────────────────

function sessionIdFromKey(key) {
  // "TT-2026-04-10.txt" → "TT-2026-04-10"
  return key.replace(/\.(txt|html)$/i, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  const transcriptBase = (process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT || "").replace(/\/$/, "");

  console.log("🔍 Listing transcript bucket keys…");
  const allKeys = await listKeys(TRANSCRIPT_BUCKET, "");

  // Only process .txt files (skip any .html already generated)
  const txtKeys = allKeys.filter(
    (k) => typeof k === "string" && k.endsWith(".txt") && !k.includes("/")
  );

  if (txtKeys.length === 0) {
    console.log("⚠️  No .txt transcript files found. Nothing to backfill.");
    return;
  }

  console.log(`📋 Found ${txtKeys.length} .txt transcript(s) to process.`);
  if (DRY_RUN) console.log("🔶 DRY RUN — no files will be uploaded.\n");

  let success = 0;
  let skipped = 0;
  let failed  = 0;

  for (const key of txtKeys) {
    const sessionId = sessionIdFromKey(key);
    process.stdout.write(`  • ${sessionId} … `);

    try {
      // 1) Fetch the plain-text transcript
      const transcriptText = await getObjectAsText(TRANSCRIPT_BUCKET, key);
      if (!transcriptText || !transcriptText.trim()) {
        console.log("⚠️  empty — skipped");
        skipped++;
        continue;
      }

      // 2) Fetch the episode metadata (best-effort — page still generated without it)
      let meta = {};
      try {
        const metaJson = await getObjectAsText(META_BUCKET, `${sessionId}.json`);
        if (metaJson) meta = JSON.parse(metaJson);
      } catch {
        // Meta missing is non-fatal; HTML will use sessionId as title fallback
      }

      // 3) Generate HTML
      const html = generateTranscriptHtml(sessionId, transcriptText, meta, transcriptBase);

      // 4) Upload
      if (!DRY_RUN) {
        await uploadText(TRANSCRIPT_BUCKET, `${sessionId}.html`, html, "text/html");
      }

      console.log(`✅  done${DRY_RUN ? " (dry run)" : ""}`);
      success++;

      // Gentle rate-limit — avoid hammering R2
      await sleep(300);

    } catch (err) {
      console.log(`❌  FAILED — ${err?.message || String(err)}`);
      failed++;
    }
  }

  console.log(`
════════════════════════════════════
Backfill complete
  Processed : ${txtKeys.length}
  ✅ Success : ${success}
  ⏭  Skipped : ${skipped}
  ❌ Failed  : ${failed}
${DRY_RUN ? "\n🔶 DRY RUN — no files were uploaded." : ""}
════════════════════════════════════`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("💥 Backfill script crashed:", err);
  process.exit(1);
});
