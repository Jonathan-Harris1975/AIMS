// ============================================================
// 🎚 Podcast Processor — Clean Final Version (Fully Updated)
// ============================================================

import { spawn } from "node:child_process";
import { info, warn, error, debug } from "../../../logger.js";
import { putObject, putPrivateJson, getObjectAsText, getObjectAsBuffer, buildR2Reference } from "../../shared/utils/r2-client.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAtempoFilter, calculateMainAudioFit, resolvePodcastDurationPolicy } from "../../shared/utils/podcastDurationPolicy.js";

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

function buildTranscriptAssetUrl(baseUrl, sessionId, extension) {
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  const sid = String(sessionId || "").trim();
  if (!base || !sid) return "";
  const ext = String(extension || "").replace(/^\./, "");
  return `${base}/${sid}.${ext}`;
}

function normalisePodcastProcessorInput(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      sessionId: input.sessionId,
      artUrl: input.artUrl,
      imageGenerationStatus: input.imageGenerationStatus,
      imageGenerationError: input.imageGenerationError,
    };
  }

  return {
    sessionId: typeof input === "string" ? input : undefined,
    artUrl: "",
    imageGenerationStatus: "",
    imageGenerationError: "",
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TMP_DIR = path.resolve(process.env.PODCAST_MASTER_TMP_DIR || path.join(process.env.APP_TMP_DIR || "/tmp", "podcast_master"));
const PODCAST_FETCH_TIMEOUT_MS = Number(process.env.PODCAST_FETCH_TIMEOUT_MS) || 30_000;
const FFMPEG_TIMEOUT_MS = Number(process.env.PODCAST_FFMPEG_TIMEOUT_MS) || 900_000;
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function runFFmpeg(args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args);
    let stderr = "";

    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve({ ok: true }) : reject(new Error(stderr));
    });
  });
}

function probeAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    ff.stdout.on("data", (data) => { stdout += data.toString(); });
    ff.stderr.on("data", (data) => { stderr += data.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      const duration = Number.parseFloat(stdout.trim());
      if (code === 0 && Number.isFinite(duration) && duration > 0) return resolve(duration);
      reject(new Error(`ffprobe failed for ${filePath}: ${stderr || stdout || `exit ${code}`}`));
    });
  });
}

async function safePutObject(bucketAlias, key, body, contentType) {
  let ct = contentType;

  if (ct !== undefined) {
    ct = String(ct).replace(/[\r\n\t]+/g, " ").trim();
  }

  try {
    if (ct) return await putObject(bucketAlias, key, body, ct);
    return await putObject(bucketAlias, key, body);
  } catch (err) {
    const msg = String(err?.message || "");
    const headerErr =
      err?.code === "ERR_INVALID_CHAR" ||
      msg.includes('Invalid character in header content ["content-type"]');

    if (!headerErr) throw err;

    warn("⚠️ Retrying without contentType", {
      bucketAlias,
      key,
      error: err.message,
    });

    return await putObject(bucketAlias, key, body);
  }
}

function cleanup(files) {
  files.forEach((f) => {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  });
}

async function updateMetaFile(sessionId, finalBuffer, finalPath, podcastUrl, artworkMeta = {}) {
  const metaKey = `${sessionId}.json`;

  const artBase = process.env.R2_PUBLIC_BASE_URL_ART || "";
  const transcriptBase = process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT || "";
  const siteBaseUrl = process.env.SITE_BASE_URL || "https://jonathan-harris.online";
  const transcriptHtmlBase =
    process.env.PODCAST_TRANSCRIPT_HTML_BASE_URL ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML ||
    joinUrl(siteBaseUrl, "transcripts") ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
    "";

  const metaUri = buildR2Reference("meta", metaKey);

  let existing = {};
  try {
    existing = JSON.parse(await getObjectAsText("meta", metaKey));
  } catch {
    existing = {};
  }

  const sessionDate =
    existing?.session?.date ||
    existing?.createdAt ||
    new Date().toISOString();

  let duration = null;
  try {
    duration = await probeAudioDuration(finalPath);
  } catch {}

  const title = existing.title || "AI Hype Hits the Plumbing";
  const episodeSlug = existing.episodeSlug || slugify(title || sessionId);
  const durationSeconds =
    typeof duration === "number"
      ? duration
      : typeof existing.duration === "number"
      ? existing.duration
      : typeof existing.plannedDurationSeconds === "number"
      ? existing.plannedDurationSeconds
      : null;
  const episodePageUrl = joinUrl(siteBaseUrl, `podcast/episodes/${episodeSlug}/`);
  const transcriptTextUrl = buildTranscriptAssetUrl(transcriptBase, sessionId, "txt");
  const transcriptHtmlUrl = buildTranscriptAssetUrl(transcriptHtmlBase, sessionId, "html");
  const resolvedArtUrl =
    String(artworkMeta?.artUrl || "").trim() ||
    String(existing.artUrl || "").trim() ||
    (artBase ? `${artBase}/${sessionId}.png` : "");
  const imageGenerationStatus =
    String(artworkMeta?.imageGenerationStatus || "").trim() ||
    String(existing.imageGenerationStatus || "").trim() ||
    (resolvedArtUrl ? "generated" : "missing");
  const imageGenerationError =
    String(artworkMeta?.imageGenerationError || "").trim() ||
    String(existing.imageGenerationError || "").trim();

  const updated = {
    session: { sessionId, date: sessionDate },
    sessionId,
    title,
    description: existing.description || "",
    host: existing.host || "Jonathan Harris",
    podcastTitle: existing.podcastTitle || "Turing’s Torch: Artificial Intelligence Weekly",
    targetMins: existing.targetMins || existing.durationPlan?.targetMins || null,
    targetMinutes: existing.targetMinutes || existing.durationPlan?.targetMinutes || existing.targetMins || null,
    plannedDurationSeconds: existing.plannedDurationSeconds || existing.durationPlan?.plannedDurationSeconds || null,
    durationPlan: existing.durationPlan || null,
    keywords: existing.keywords || [],
    seoKeywordCandidates: existing.seoKeywordCandidates || [],
    topics: existing.topics || [],
    summary: existing.summary || existing.episodeSummary || existing.shortSummary || existing.description || "",
    episodeSummary: existing.episodeSummary || existing.summary || existing.shortSummary || existing.description || "",
    shortSummary: existing.shortSummary || existing.episodeSummary || existing.summary || existing.description || "",
    keyTakeaways: existing.keyTakeaways || existing.takeaways || [],
    takeaways: existing.takeaways || existing.keyTakeaways || [],
    entities: existing.entities || [],
    topicIndex: existing.topicIndex || [],
    discoveryMetadata: existing.discoveryMetadata || null,
    itunesKeywords: existing.itunesKeywords || existing.discoveryMetadata?.legacy?.itunesKeywordsCsv || "",
    artworkPrompt: existing.artworkPrompt || "",
    episodeNumber: existing.episodeNumber || 1,
    episodeSlug,
    episodePageUrl,
    // This is the publication gate used by the public RSS and website. It is
    // written only after the final mastered audio has been uploaded successfully.
    productionComplete: true,
    productionCompletedAt: new Date().toISOString(),
    episodePublicationReady: true,
    episodePublicationReadyAt: new Date().toISOString(),
    createdAt: existing.createdAt || sessionDate,
    updatedAt: new Date().toISOString(),
    artUrl: resolvedArtUrl,
    imageGenerationStatus,
    imageGenerationError,
    transcriptTextUrl,
    transcriptHtmlUrl,
    transcriptUrl: transcriptHtmlUrl || transcriptTextUrl,
    podcastUrl,
    duration: durationSeconds,
    actualDurationSeconds: typeof duration === "number" ? duration : null,
    maximumDurationMinutes: artworkMeta?.maximumDurationMinutes || existing.maximumDurationMinutes || null,
    durationAutomaticallyAdjusted: Boolean(artworkMeta?.durationAutomaticallyAdjusted),
    durationTempoFactor: artworkMeta?.durationTempoFactor || null,
    durationBeforeAdjustmentSeconds: artworkMeta?.durationBeforeAdjustmentSeconds || null,
    fileSize: finalBuffer.length,
    pubDate: new Date(sessionDate).toUTCString(),
  };

  await putPrivateJson("meta", metaKey, updated);

  return { metaKey, metaUri };
}

export async function podcastProcessor(input, editedPathOrBuffer) {
  const {
    sessionId,
    artUrl,
    imageGenerationStatus,
    imageGenerationError,
  } = normalisePodcastProcessorInput(input);

  const introUrl = requireEnv("PODCAST_INTRO_URL");
  const outroUrl = requireEnv("PODCAST_OUTRO_URL");
  const publicBasePodcast = requireEnv("R2_PUBLIC_BASE_URL_PODCAST");

  let editedBuffer;
  let editedSource = "r2";

  if (typeof editedPathOrBuffer === "string" && fs.existsSync(editedPathOrBuffer)) {
    info("🎚 Using local edited audio", { sessionId, path: editedPathOrBuffer });
    editedBuffer = fs.readFileSync(editedPathOrBuffer);
    editedSource = "local";
  } else if (Buffer.isBuffer(editedPathOrBuffer)) {
    info("🎚 Using in-memory edited audio", { sessionId });
    editedBuffer = editedPathOrBuffer;
    editedSource = "buffer";
  } else {
    const editedKey = `${sessionId}_edited.mp3`;
    info("🎚 Fetching edited audio from authenticated R2", { sessionId, editedKey });
    editedBuffer = await getObjectAsBuffer("editedAudio", editedKey);
  }

  info("🎧 Retrieved edited audio", { sessionId, source: editedSource });

  const intro = `${TMP_DIR}/${sessionId}_intro.mp3`;
  const main = `${TMP_DIR}/${sessionId}_main.mp3`;
  const outro = `${TMP_DIR}/${sessionId}_outro.mp3`;
  const fittedMain = `${TMP_DIR}/${sessionId}_main_fitted.mp3`;
  const final = `${TMP_DIR}/${sessionId}_final.mp3`;
  const emergencyFinal = `${TMP_DIR}/${sessionId}_final_fitted.mp3`;
  const list = `${TMP_DIR}/${sessionId}_list.txt`;
  const tempFiles = [intro, main, fittedMain, outro, final, emergencyFinal, list];

  try {
    fs.writeFileSync(main, editedBuffer);

    async function dl(url, dest) {
      const r = await fetchWithTimeout(url, { timeout: PODCAST_FETCH_TIMEOUT_MS });
      if (!r.ok) throw new Error(`Download failed: ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    }

    await dl(introUrl, intro);
    await dl(outroUrl, outro);

    const durationPolicy = resolvePodcastDurationPolicy();
    const [introSeconds, mainSeconds, outroSeconds] = await Promise.all([
      probeAudioDuration(intro),
      probeAudioDuration(main),
      probeAudioDuration(outro),
    ]);
    const fit = calculateMainAudioFit({
      mainSeconds, introSeconds, outroSeconds, maxSeconds: durationPolicy.maxSeconds, safetySeconds: 1,
    });
    let mainForMix = main;
    let durationAutomaticallyAdjusted = false;
    let durationTempoFactor = null;

    if (fit.needsAdjustment) {
      durationAutomaticallyAdjusted = true;
      durationTempoFactor = fit.requiredTempo;
      warn("podcast.duration.auto_fit.main", {
        sessionId, targetMinutes: durationPolicy.targetMinutes, maxMinutes: durationPolicy.maxMinutes,
        introSeconds, mainSeconds, outroSeconds, originalTotalSeconds: fit.originalTotalSeconds,
        tempoFactor: fit.requiredTempo, projectedTotalSeconds: fit.projectedTotalSeconds,
      });
      await runFFmpeg([
        "-y", "-i", main, "-filter:a", buildAtempoFilter(fit.requiredTempo),
        "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "192k", fittedMain,
      ]);
      mainForMix = fittedMain;
    }

    fs.writeFileSync(list, `file '${intro}'\nfile '${mainForMix}'\nfile '${outro}'\n`);

    await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-b:a", "192k", final]);

    let finalPath = final;
    let finalDurationSeconds = await probeAudioDuration(finalPath);
    if (finalDurationSeconds > durationPolicy.maxSeconds + 0.25) {
      const finalTempo = finalDurationSeconds / durationPolicy.maxSeconds;
      durationAutomaticallyAdjusted = true;
      durationTempoFactor = (durationTempoFactor || 1) * finalTempo;
      warn("podcast.duration.auto_fit.final", { sessionId, finalDurationSeconds, maxSeconds: durationPolicy.maxSeconds, tempoFactor: finalTempo });
      await runFFmpeg([
        "-y", "-i", finalPath, "-filter:a", buildAtempoFilter(finalTempo),
        "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "192k", emergencyFinal,
      ]);
      finalPath = emergencyFinal;
      finalDurationSeconds = await probeAudioDuration(finalPath);
    }
    if (finalDurationSeconds > durationPolicy.maxSeconds + 0.25) {
      throw new Error(`Automatic duration fitting failed: ${finalDurationSeconds.toFixed(2)}s exceeds ${durationPolicy.maxSeconds}s.`);
    }

    info("podcast.duration.final", {
      sessionId, targetMinutes: durationPolicy.targetMinutes, maxMinutes: durationPolicy.maxMinutes,
      finalDurationSeconds, adjusted: durationAutomaticallyAdjusted, tempoFactor: durationTempoFactor,
    });

    const finalBuffer = fs.readFileSync(finalPath);

    const podcastKey = `${sessionId}.mp3`;
    const podcastUrl = `${publicBasePodcast}/${podcastKey}`;

    await safePutObject("podcast", podcastKey, finalBuffer, "audio/mpeg");

    info("📡 Uploaded final podcast", { sessionId, podcastKey });

    await updateMetaFile(sessionId, finalBuffer, finalPath, podcastUrl, {
      artUrl,
      imageGenerationStatus,
      imageGenerationError,
      maximumDurationMinutes: durationPolicy.maxMinutes,
      durationAutomaticallyAdjusted,
      durationTempoFactor,
      durationBeforeAdjustmentSeconds: fit.originalTotalSeconds,
    });

    return {
      buffer: finalBuffer,
      key: podcastKey,
      url: podcastUrl,
      artUrl,
      imageGenerationStatus,
      imageGenerationError,
      durationSeconds: finalDurationSeconds,
      maximumDurationMinutes: durationPolicy.maxMinutes,
      durationAutomaticallyAdjusted,
      durationTempoFactor,
    };
  } finally {
    cleanup(tempFiles);
  }
}

export default podcastProcessor;
