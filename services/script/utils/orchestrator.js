// ====================================================================
// orchestrator.js 
// ====================================================================

import { info, error, debug } from "../../../logger.js";
import models from "./models.js";
import { composeEpisode } from "../routes/composeScript.js";
import { uploadText } from "../../shared/utils/r2-client.js"
import chunkText from "./chunkText.js";
import { generateEpisodeMetaLLM } from "./podcastHelper.js";
import * as sessionCache from "./sessionCache.js";
import { attachEpisodeNumberIfNeeded } from "./episodeCounter.js";
import editAndFormat from "./editAndFormat.js";
import { runEditorialPass } from "./editorialPass.js";
import { validateTranscriptStructure } from "./scriptValidation.js";

const {
  generateIntro,
  generateMain,
  generateOutro,
} = models;

// Cleanup after a few minutes to avoid session buildup
function scheduleCleanup(sessionId) {
  setTimeout(async () => {
    try {
      sessionCache.clearSession(sessionId);
    } catch (_) {}
  }, 4 * 60 * 1000);
}

export async function orchestrateScript(input) {
  // Support both legacy string version and meta-object version
  const sessionMeta =
    typeof input === "string"
      ? { sessionId: input }
      : input && typeof input === "object"
      ? { ...input }
      : {};

  const sid =
    sessionMeta.sessionId ||
    sessionMeta.id ||
    `TT-${new Date().toISOString().slice(0, 10)}`;

  sessionMeta.sessionId = sid;

  debug("🧠 Orchestrate Script: start", { sessionId: sid });

  try {
    // ============================================================
    // 1) Generate intro, main, outro (using updated Option A models)
    // ============================================================
    const intro = await generateIntro(sid);
    const main = await generateMain(sid);
    const outro = await generateOutro(sid);

    // ============================================================
    // 2) High-level composition pass (structure, ordering, cleanup)
    // ============================================================
    const composed = await composeEpisode({
      sessionId: sid,
      intro,
      main,
      outro,
    });

    const initialFullText =
      composed?.fullText ?? [intro, main, outro].join("\n\n");

    const initialValidation = validateTranscriptStructure(initialFullText);
    if (!initialValidation.ok) {
      throw new Error(`Composed script failed structure validation: ${initialValidation.reasons.join("; ")}`);
    }

    // ============================================================
    // 3) Editorial Pass (humanisation, variety, tone consistency)
    // ============================================================
    const editorialText = await runEditorialPass(
      { sessionId: sid, ...sessionMeta },
      initialFullText
    );

    const editorialCandidate = (editorialText && editorialText.trim()) || initialFullText;
    const editorialValidation = validateTranscriptStructure(editorialCandidate);
    const safeEditorialText = editorialValidation.ok ? editorialCandidate : initialFullText;

    if (!editorialValidation.ok) {
      info("editorialPass.fallback.initialScript", {
        sessionId: sid,
        reasons: editorialValidation.reasons,
      });
    }

    // ============================================================
    // 4) Local formatting pass (punctuation, spacing, flow polish)
    // ============================================================
    const formattedText = editAndFormat(safeEditorialText);

    const finalCandidate =
      (formattedText && formattedText.trim()) ||
      safeEditorialText ||
      initialFullText;

    const finalValidation = validateTranscriptStructure(finalCandidate);
    if (!finalValidation.ok) {
      throw new Error(`Final script failed structure validation: ${finalValidation.reasons.join("; ")}`);
    }

    const finalFullText = finalCandidate;

    // ============================================================
    // 5) Chunk for TTS + upload to R2
    // ============================================================
    const chunks = chunkText(finalFullText);
    const uploadedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const key = `${sid}/chunk-${String(i + 1).padStart(3, "0")}.txt`;
      await uploadText("rawtext", key, chunks[i], "text/plain");
      uploadedChunks.push(key);
    }

    // ============================================================
    // 6) Store full transcript
    // ============================================================
    await uploadText("transcript", `${sid}.txt`, finalFullText, "text/plain");

    // ============================================================
    // 7) Metadata (title, SEO, artwork prompt, episode number)
    // ============================================================
    let meta = await generateEpisodeMetaLLM(finalFullText, {
      sessionId: sid,
      date: sessionMeta.date,
      episodeNumber: sessionMeta.episodeNumber,
    });

    meta = await attachEpisodeNumberIfNeeded(meta);

    const metaKey = `${sid}.json`;
    await uploadText(
      "meta",
      metaKey,
      JSON.stringify(meta, null, 2),
      "application/json"
    );

    // ============================================================
    // 8) Session cleanup (optional)
    // ============================================================
    scheduleCleanup(sid);

    info("✅ Script orchestration complete");

    return {
      ...composed,
      fullText: finalFullText,
      chunks: uploadedChunks,
      metadata: meta,
    };

  } catch (err) {
    error("💥 Script orchestration failed", {
      sessionId: sid,
      error: err?.message,
      stack: err?.stack,
    });
    throw err;
  }
}

export const orchestrateEpisode = orchestrateScript;
export default orchestrateScript;
