// ============================================================
// 🎬 TTS Orchestrator — Full Audio Generation Pipeline (FIXED)
// ============================================================

import { info, error, debug } from "../../../logger.js";
import { startKeepAlive, stopKeepAlive } from "../../shared/utils/keepalive.js";
import { listKeys, getObject } from "../../shared/utils/r2-client.js";
import { ttsProcessor } from "./ttsProcessor.js";
import { mergeProcessor } from "./mergeProcessor.js";
import { editingProcessor } from "./editingProcessor.js";
import { podcastProcessor } from "./podcastProcessor.js";

/* ============================================================
   R2 configuration
============================================================ */
const RAW_TEXT_BUCKET = "rawtext";
const PUBLIC_BASE_URL_PODCAST = process.env.R2_PUBLIC_BASE_URL_PODCAST;

function validateTtsRuntimeConfig() {
  const missing = [];

  if (!process.env.R2_BUCKET_RAW_TEXT) missing.push("R2_BUCKET_RAW_TEXT");
  if (!process.env.R2_BUCKET_PODCAST) missing.push("R2_BUCKET_PODCAST");

  if (missing.length) {
    throw new Error(`Missing required TTS environment variables: ${missing.join(", ")}`);
  }
}

/* ============================================================
   📥 Load all text chunks from R2
============================================================ */
async function loadTextChunksFromR2(sessionId) {
  debug("🔍 Listing text chunks from R2...", { sessionId });

  const chunkKeys = await listKeys(RAW_TEXT_BUCKET, `${sessionId}/chunk-`);

  if (!chunkKeys || chunkKeys.length === 0) {
    throw new Error(`No .txt chunks found in R2 for session ${sessionId}`);
  }

  const txtKeys = chunkKeys.filter((key) => key.endsWith(".txt")).sort();

  info("🟩 Text chunks collected");
  debug("🧩 Text chunks collected", {
    sessionId,
    count: txtKeys.length,
  });

  const chunkList = [];

  for (const key of txtKeys) {
    const buf = await getObject(RAW_TEXT_BUCKET, key);

    if (!buf) {
      throw new Error(`Failed to download text chunk: ${key}`);
    }

    const text = buf.toString("utf8").trim();

    chunkList.push({
      key,
      text,
    });
  }

  return chunkList;
}

/* ============================================================
   🚀 Main TTS Orchestration
============================================================ */
export async function orchestrateTTS(session) {
  const sessionInput =
    typeof session === "object" && session
      ? session
      : { sessionId: session };

  const sessionId = sessionInput?.sessionId;
  const artUrl = sessionInput?.artUrl || "";
  const imageGenerationStatus = sessionInput?.imageGenerationStatus || "";
  const imageGenerationError = sessionInput?.imageGenerationError || "";

  const t0 = Date.now();
  info("🎬 Orchestration begin", { sessionId });

  try {
    validateTtsRuntimeConfig();
    startKeepAlive("ttsProcessor", 220000);

    // 1️⃣ Load text chunks
    const chunkList = await loadTextChunksFromR2(sessionId);

    // 2️⃣ Generate TTS chunks
    const t1 = Date.now();
    const ttsResults = await ttsProcessor(sessionId, chunkList);

    const successSources = ttsResults
      .filter((r) => r.success)
      .map((r) => r.r2Uri || r.url)
      .filter(Boolean);

    if (successSources.length === 0) {
      throw new Error("No TTS chunks were produced.");
    }

    info("🗣️ TTS saved to R2");
    debug("🗣️ TTS complete", {
      sessionId,
      count: successSources.length,
      ms: Date.now() - t1,
    });

    // 3️⃣ Merge chunks
    const t2 = Date.now();
    const merged = await mergeProcessor(sessionId, successSources);

    if (!merged?.key) {
      throw new Error("Merge step failed to produce output.");
    }

    info("🟩 Merge saved to R2");
    debug("🧩 Merge complete", {
      sessionId,
      key: merged.key,
      ms: Date.now() - t2,
    });

    // 4️⃣ Editing
    const t3 = Date.now();
    const editedPath = await editingProcessor(sessionId, merged);

    if (!editedPath || typeof editedPath !== "string") {
      throw new Error("Editing did not return a valid output path.");
    }

    info("🟩 Editing saved to R2");
    debug("✂️ Editing complete", {
      sessionId,
      editedPath,
      ms: Date.now() - t3,
    });

    // 5️⃣ Podcast mixdown
    const t4 = Date.now();
    const final = await podcastProcessor(
      {
        sessionId,
        artUrl,
        imageGenerationStatus,
        imageGenerationError,
      },
      editedPath
    );

    const finalBuffer = final?.buffer;
    const finalKey = final?.key || `${sessionId}_podcast.mp3`;
    const finalUrl =
      final?.url ||
      (PUBLIC_BASE_URL_PODCAST
        ? `${PUBLIC_BASE_URL_PODCAST}/${finalKey}`
        : null);

    if (!finalBuffer || finalBuffer.length === 0) {
      throw new Error("Mixdown step returned no audio data.");
    }

    info("🎚️ Final podcast audio ready", { sessionId });
    debug("🎚️ Mixdown complete", {
      sessionId,
      bytes: finalBuffer.length,
      key: finalKey,
      url: finalUrl,
      ms: Date.now() - t4,
    });

    info("✅ Orchestration complete", {
      sessionId,
      totalMs: Date.now() - t0,
    });

    return {
      ok: true,
      sessionId,
      key: finalKey,
      url: finalUrl,
    };
  } catch (err) {
    error("❌ Orchestration failed", {
      sessionId,
      error: err.message,
      stack: err.stack,
    });

    return {
      ok: false,
      sessionId,
      error: err.message,
    };
  } finally {
    stopKeepAlive("ttsProcessor");
  }
}

export default orchestrateTTS;
