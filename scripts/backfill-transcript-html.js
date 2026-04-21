// ============================================================
// scripts/backfill-transcript-html.js
// Backfill HTML transcript pages for all plain-text transcripts and
// repair canonical podcast metadata for the historical archive.
//
// Run from repo root:
//   node scripts/backfill-transcript-html.js
//   node scripts/backfill-transcript-html.js --dry-run
//   node scripts/backfill-transcript-html.js --skip-rss
// ============================================================

import "dotenv/config";
import {
  listKeys,
  getObjectAsText,
  uploadText,
} from "../services/shared/utils/r2-client.js";
import { generateTranscriptHtml } from "../services/script/utils/generateTranscriptHtml.js";
import { runRssFeedCreator } from "../services/rss-feed-podcast/index.js";

const TRANSCRIPT_BUCKET = "transcript";
const META_BUCKET = "meta";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_RSS = process.argv.includes("--skip-rss");

function sessionIdFromKey(key) {
  return key.replace(/\.(txt|html)$/i, "");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function joinUrl(base, segment) {
  return `${String(base || "").replace(/\/$/, "")}/${String(segment || "").replace(/^\//, "")}`;
}

function buildAssetUrl(baseUrl, sessionId, extension) {
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  const sid = String(sessionId || "").trim();
  if (!base || !sid) return "";
  return `${base}/${sid}.${String(extension || "").replace(/^\./, "")}`;
}

function deriveSessionDate(sessionId, meta = {}) {
  const candidates = [
    meta?.session?.date,
    meta?.createdAt,
    meta?.updatedAt,
    meta?.pubDate,
  ].filter(Boolean);
  if (candidates.length > 0) {
    const first = new Date(candidates[0]);
    if (!Number.isNaN(first.getTime())) return first.toISOString();
  }

  const match = String(sessionId || "").match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return `${match[1]}T00:00:00.000Z`;
  }

  return new Date().toISOString();
}

function normalizeEpisodeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

function buildRepairedMeta(sessionId, existing = {}) {
  const siteBaseUrl = String(process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const transcriptBase =
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
    process.env.R2_PUBLIC_BASE_URL_RAW_TEXT ||
    "";
  const transcriptHtmlBase =
    process.env.PODCAST_TRANSCRIPT_HTML_BASE_URL ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML ||
    joinUrl(siteBaseUrl, "transcripts") ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
    "";
  const podcastBase = process.env.R2_PUBLIC_BASE_URL_PODCAST || "";
  const artBase = process.env.R2_PUBLIC_BASE_URL_ART || "";

  const sessionDate = deriveSessionDate(sessionId, existing);
  const title = existing.title || `Turing's Torch AI Weekly — ${sessionId}`;
  const episodeSlug = existing.episodeSlug || slugify(title || sessionId);
  const episodeNumber = normalizeEpisodeNumber(existing.episodeNumber);
  const transcriptTextUrl = buildAssetUrl(transcriptBase, sessionId, "txt");
  const transcriptHtmlUrl = buildAssetUrl(transcriptHtmlBase, sessionId, "html");
  const podcastUrl = String(existing.podcastUrl || "").trim() || buildAssetUrl(podcastBase, sessionId, "mp3");
  const artUrl = String(existing.artUrl || "").trim() || buildAssetUrl(artBase, sessionId, "png");

  const repaired = {
    ...existing,
    session: {
      ...(existing.session || {}),
      sessionId,
      date: existing?.session?.date || sessionDate,
    },
    sessionId,
    title,
    episodeSlug,
    episodePageUrl: joinUrl(siteBaseUrl, `podcast/episodes/${episodeSlug}/`),
    transcriptTextUrl,
    transcriptHtmlUrl,
    transcriptUrl: transcriptHtmlUrl || transcriptTextUrl,
    podcastUrl,
    artUrl,
    createdAt: existing.createdAt || sessionDate,
    updatedAt: new Date().toISOString(),
    pubDate: existing.pubDate ? new Date(existing.pubDate).toUTCString() : new Date(sessionDate).toUTCString(),
  };

  if (episodeNumber !== undefined) {
    repaired.episodeNumber = episodeNumber;
  }

  return repaired;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const transcriptHtmlBase = (
    process.env.PODCAST_TRANSCRIPT_HTML_BASE_URL ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML ||
    joinUrl(process.env.SITE_BASE_URL || "https://jonathan-harris.online", "transcripts") ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
    ""
  ).replace(/\/$/, "");

  console.log("🔍 Listing transcript bucket keys…");
  const allKeys = await listKeys(TRANSCRIPT_BUCKET, "");
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
  let failed = 0;
  let metaRepaired = 0;

  for (const key of txtKeys) {
    const sessionId = sessionIdFromKey(key);
    process.stdout.write(`  • ${sessionId} … `);

    try {
      const transcriptText = await getObjectAsText(TRANSCRIPT_BUCKET, key);
      if (!transcriptText || !transcriptText.trim()) {
        console.log("⚠️  empty — skipped");
        skipped++;
        continue;
      }

      let meta = {};
      try {
        const metaJson = await getObjectAsText(META_BUCKET, `${sessionId}.json`);
        if (metaJson) meta = JSON.parse(metaJson);
      } catch {
        meta = {};
      }

      const repairedMeta = buildRepairedMeta(sessionId, meta);
      const html = generateTranscriptHtml(sessionId, transcriptText, repairedMeta, transcriptHtmlBase);

      if (!DRY_RUN) {
        await uploadText(TRANSCRIPT_BUCKET, `${sessionId}.html`, html, "text/html");
        await uploadText(META_BUCKET, `${sessionId}.json`, JSON.stringify(repairedMeta, null, 2), "application/json");
      }

      console.log(`✅  transcript + meta repaired${DRY_RUN ? " (dry run)" : ""}`);
      success++;
      metaRepaired++;
      await sleep(300);
    } catch (err) {
      console.log(`❌  FAILED — ${err?.message || String(err)}`);
      failed++;
    }
  }

  if (!DRY_RUN && !SKIP_RSS) {
    console.log("\n📡 Regenerating podcast RSS feed from repaired metadata…");
    await runRssFeedCreator();
    console.log("✅ Podcast RSS regenerated.");
  }

  console.log(`
════════════════════════════════════
Backfill complete
  Processed : ${txtKeys.length}
  ✅ Success : ${success}
  🧩 Meta fixed: ${metaRepaired}
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
