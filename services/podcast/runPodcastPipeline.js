import { info, warn, error } from "../../logger.js";
import { getScriptForPodcast } from "../script/index.js";
import { processArtwork } from "../artwork/index.js";
import { orchestrateTTS } from "../tts/index.js";
import { runRssFeedCreator } from "../rss-feed-podcast/index.js";
import cleanupSession from "../shared/utils/cleanupSession.js";
import finalCleanupSession from "../shared/utils/cleanupSessionFinal.js";
import cleanupTempMemory from "../shared/utils/cleanupTempMemory.js";
import { fetchWithTimeout } from "../shared/http-client.js";
import { buildPodcastCompletionStatus } from "./completionStatus.js";

const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 15_000;

function normalisePipelineInput(input, maybeOptions = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      force: false,
      ...input,
      ...maybeOptions,
    };
  }

  return {
    sessionId: typeof input === "string" ? input : undefined,
    force: false,
    ...(maybeOptions || {}),
  };
}



async function triggerWebsiteRebuild(log, sessionId) {
  const primaryHook = String(process.env.WEBSITE_REBUILD_HOOK || "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/be062a91-ac03-4d1a-b4fe-c4d99a92b5a6").trim();
  const fallbackHook = String(process.env.WEBSITE_REBUILD_HOOK_FALLBACK || "").trim();
  const hooks = [primaryHook, fallbackHook].filter(Boolean);

  if (!hooks.length) {
    return { ok: false, skipped: true, reason: "missing-hook-url" };
  }

  let lastError = null;

  for (const hookUrl of hooks) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchWithTimeout(hookUrl, { method: "POST", timeout: WEBHOOK_TIMEOUT_MS });
        const body = await response.text().catch(() => "");

        if (response.ok) {
          log.info("🌐 Website rebuild triggered", {
            sessionId,
            hookUrl,
            attempt,
            status: response.status,
          });
          return { ok: true, hookUrl, attempt, status: response.status, body };
        }

        lastError = new Error(`non-2xx response ${response.status}`);
        log.warn("⚠️ Website rebuild trigger returned non-2xx", {
          sessionId,
          hookUrl,
          attempt,
          status: response.status,
          body: body.slice(0, 500),
        });
      } catch (rebuildErr) {
        lastError = rebuildErr;
        log.warn("⚠️ Website rebuild trigger attempt failed", {
          sessionId,
          hookUrl,
          attempt,
          error: rebuildErr?.message,
        });
      }
    }
  }

  return {
    ok: false,
    error: lastError?.message || "unknown rebuild trigger error",
  };
}

export async function runPodcastPipeline(input = {}, maybeOptions = {}) {
  const { sessionId, force } = normalisePipelineInput(input, maybeOptions);
  const log = { info, warn, error };

  if (!sessionId) {
    throw new Error("Missing required sessionId");
  }

  try {
    log.info("🚀 Podcast pipeline starting", { sessionId, force });

    log.info("📝 Generating podcast script…");
    const script = await getScriptForPodcast({ sessionId, force });
    if (!script?.ok) {
      throw new Error(script?.error || "Podcast script generation failed");
    }
    log.info("📝 Podcast script ready", { sessionId });

    log.info("🎨 Generating podcast artwork…");
    const artworkPrompt = String(script?.metadata?.artworkPrompt || "").trim();
    const artwork = await processArtwork({
      sessionId,
      force,
      prompt: artworkPrompt || undefined,
    });
    if (!artwork?.ok || !artwork?.publicUrl) {
      throw new Error(artwork?.error || "Artwork generation failed");
    }
    log.info("🎨 Artwork generation complete", {
      sessionId,
      artworkSource: artwork.source || "generated",
      imageUrl: artwork.publicUrl,
    });

    log.info("🗣️ TTS pipeline starting…");
    const tts = await orchestrateTTS({
      sessionId,
      force,
      artUrl: artwork.publicUrl,
      imageGenerationStatus: artwork.imageGenerationStatus || artwork.source || "generated",
      imageGenerationError: artwork.imageGenerationError || "",
    });
    if (!tts?.ok) {
      throw new Error(tts?.error || "TTS pipeline failed");
    }
    log.info("🗣️ TTS pipeline complete", { sessionId });

    log.info("📡 Updating RSS feed…");
    let rss;
    try {
      const result = await runRssFeedCreator();
      rss = { ok: result?.ok !== false, result: result ?? null };
      log.info("📡 RSS feed updated successfully");
    } catch (rssErr) {
      rss = { ok: false, error: rssErr?.message || String(rssErr) };
      log.error("❌ RSS feed update failed", {
        sessionId,
        error: rss.error,
      });
    }

    const maintenanceWarnings = [];
    try {
      log.info("🧹 Cleaning R2 artefacts…");
      await cleanupSession(sessionId);
      await finalCleanupSession(sessionId);
      log.info("🧹 R2 cleanup complete");
    } catch (cleanupErr) {
      maintenanceWarnings.push({ stage: "r2-cleanup", error: cleanupErr?.message || String(cleanupErr) });
      log.error("⚠️ R2 cleanup failed", {
        sessionId,
        error: cleanupErr?.message,
      });
    }

    try {
      log.info("🧽 Clearing temporary memory…");
      await cleanupTempMemory(sessionId);
      log.info("🧽 Temporary memory cleared");
    } catch (memErr) {
      maintenanceWarnings.push({ stage: "temporary-memory-cleanup", error: memErr?.message || String(memErr) });
      log.warn("⚠️ Memory cleanup failed", {
        sessionId,
        error: memErr?.message,
      });
    }

    log.info("🌐 Triggering website rebuild…");
    const rebuild = await triggerWebsiteRebuild(log, sessionId);
    if (!rebuild.ok) {
      log.warn("⚠️ Website rebuild did not confirm success", {
        sessionId,
        error: rebuild.error || rebuild.reason || "unknown",
      });
    }

    const completion = buildPodcastCompletionStatus({ rss, rebuild });
    const summary = {
      ...completion,
      sessionId,
      script,
      artwork,
      tts,
      rss,
      rebuild,
      maintenanceWarnings,
    };

    if (summary.partialFailure) {
      log.error("Podcast production completed with publication failures", { sessionId, issues: summary.issues });
    } else {
      log.info("🏁 Podcast pipeline complete", { sessionId });
    }
    return summary;
  } catch (err) {
    log.error("💥 Podcast pipeline failed", {
      sessionId,
      error: err?.message,
      stack: err?.stack,
    });
    throw err;
  }
}

export default runPodcastPipeline;
