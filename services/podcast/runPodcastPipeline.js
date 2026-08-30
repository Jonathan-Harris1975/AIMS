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
import {
  claimPendingEditorialBriefs,
  editorialBriefFingerprint,
  editorialBriefIds,
  editorialBriefPromptContext,
  finaliseEditorialBriefsAfterPublication,
  markEditorialBriefsReconciliationRequired,
  releaseEditorialBriefClaims,
} from "../comms-hub/contentAutomationQueue.js";

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

async function advancePublishedCommsContributions(entries, { episodeUrl, publicationId } = {}) {
  const conversationIds = [...new Set(
    (entries || [])
      .map((entry) => String(entry?.brief?.source?.conversationId || "").trim())
      .filter(Boolean)
  )];
  if (!conversationIds.length) return { skipped: true, reason: "no_comms_contributions", results: [] };
  if (!/^https:\/\//i.test(String(episodeUrl || ""))) {
    throw new Error("Published podcast contribution hand-off requires a canonical HTTPS episode URL.");
  }

  const { getCommsHubContext, getCommsHubRuntimeReadiness } = await import("../comms-hub/runtime.js");
  const readiness = getCommsHubRuntimeReadiness();
  if (!readiness.ready || readiness.status === "disabled") {
    throw new Error(`Comms Hub is not ready for podcast publication hand-off (${readiness.status || "unknown"}:${readiness.detail || "unknown"}).`);
  }
  const context = getCommsHubContext();
  const results = [];
  for (const conversationId of conversationIds) {
    results.push({
      conversationId,
      result: await context.podcastWorkflowService.advancePublishedContribution({
        conversationId,
        episodeUrl,
        publicationId,
      }),
    });
  }
  return { skipped: false, results };
}



async function triggerWebsiteRebuild(log, sessionId) {
  const primaryHook = String(process.env.WEBSITE_REBUILD_HOOK || "").trim();
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
  const pipelineInput = normalisePipelineInput(input, maybeOptions);
  const { sessionId, force } = pipelineInput;
  const log = { info, warn, error };
  let editorialBriefEntries = [];
  let editorialBriefFinalised = false;

  if (!sessionId) {
    throw new Error("Missing required sessionId");
  }

  try {
    log.info("🚀 Podcast pipeline starting", { sessionId, force });

    editorialBriefEntries = await claimPendingEditorialBriefs("podcast", {
      limit: Number(process.env.COMMS_HUB_CONTENT_AUTOMATION_BRIEF_LIMIT || 3),
      consumerId: sessionId,
    });
    const editorialContext = editorialBriefPromptContext(editorialBriefEntries);
    const editorialFingerprint = editorialBriefFingerprint(editorialBriefEntries);

    log.info("📝 Generating podcast script…");
    const script = await getScriptForPodcast({
      ...pipelineInput,
      sessionId,
      force,
      editorialContext,
      editorialBriefs: editorialBriefEntries.map((entry) => entry.brief),
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: editorialFingerprint,
    });
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
    if (!artwork?.ok || !artwork?.publicUrl || artwork?.source !== "generated" || !artwork?.key) {
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
      const result = await runRssFeedCreator({ requiredSessionId: sessionId });
      if (!result?.ok) throw new Error(result?.reason || "RSS feed generation did not confirm success");
      rss = { ok: true, result };
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
    let publicationHandoff = { skipped: true, reason: "publication_not_confirmed", results: [] };
    let briefHandoff = { ok: true, skipped: true, reason: "no_editorial_briefs" };
    const episodeUrl = rss?.result?.episode?.url || null;
    if (completion.ok) {
      try {
        publicationHandoff = await advancePublishedCommsContributions(editorialBriefEntries, {
          episodeUrl,
          publicationId: sessionId,
        });
        if (editorialBriefEntries.length) {
          editorialBriefFinalised = true;
          briefHandoff = await finaliseEditorialBriefsAfterPublication(editorialBriefEntries, {
            consumerId: sessionId,
            resultReference: {
              sessionId,
              episodeUrl: episodeUrl || null,
              rssPublished: true,
              websiteRebuildConfirmed: true,
            },
            reconciliationReason: "podcast_published_but_brief_archive_failed",
          });
          if (!briefHandoff.ok) {
            completion.ok = false;
            completion.partialFailure = true;
            completion.issues.push({ stage: "editorial-brief-handoff", error: briefHandoff.status || "brief hand-off requires reconciliation" });
          }
        }
      } catch (handoffError) {
        publicationHandoff = { ok: false, error: handoffError?.message || String(handoffError), results: [] };
        if (editorialBriefEntries.length) {
          editorialBriefFinalised = true;
          const reconciliation = await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
            consumerId: sessionId,
            resultReference: { sessionId, episodeUrl, rssPublished: true, websiteRebuildConfirmed: true },
            reason: "podcast_published_but_contribution_handoff_failed",
          });
          briefHandoff = {
            ok: false,
            skipped: false,
            status: reconciliation.every((item) => item.ok === true) ? "reconciliation_required" : "reconciliation_failed",
            reconciliationRequired: true,
            reconciliation,
          };
        }
        completion.ok = false;
        completion.partialFailure = true;
        completion.issues.push({ stage: "comms-publication-handoff", error: publicationHandoff.error });
        log.error("Podcast publication hand-off failed", { sessionId, error: publicationHandoff.error });
      }
    } else if (rss?.ok && editorialBriefEntries.length) {
      editorialBriefFinalised = true;
      const reconciliation = await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
        consumerId: sessionId,
        resultReference: { sessionId, episodeUrl, rssPublished: true, websiteRebuildConfirmed: false },
        reason: "podcast_rss_published_but_website_rebuild_not_confirmed",
      });
      briefHandoff = {
        ok: false,
        skipped: false,
        status: reconciliation.every((item) => item.ok === true) ? "reconciliation_required" : "reconciliation_failed",
        reconciliationRequired: true,
        reconciliation,
      };
    }
    const summary = {
      ...completion,
      sessionId,
      script,
      artwork,
      tts,
      rss,
      rebuild,
      publicationHandoff,
      briefHandoff,
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
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
  } finally {
    if (editorialBriefEntries.length && !editorialBriefFinalised) {
      await releaseEditorialBriefClaims(editorialBriefEntries, {
        consumerId: sessionId,
        reason: "podcast_failed_before_confirmed_rss_publication",
      }).catch((releaseError) => {
        log.error("Podcast editorial brief claim release failed", { sessionId, error: releaseError?.message || String(releaseError) });
      });
    }
  }
}

export default runPodcastPipeline;
