// ============================================================
// 🎚 Podcast Processor — Clean Final Version (Fully Updated)
// ============================================================

import { spawn } from "node:child_process";
import { info, warn, error, debug } from "../../../logger.js";
import { putObject } from "../../shared/utils/r2-client.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const TMP_DIR = "/tmp/podcast_master";
const PODCAST_FETCH_TIMEOUT_MS = Number(process.env.PODCAST_FETCH_TIMEOUT_MS) || 30_000;
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function runFFmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args);
    let stderr = "";

    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("FFmpeg timed out"));
    }, timeoutMs);

    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve({ ok: true }) : reject(new Error(stderr));
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

  const metaBase = process.env.R2_PUBLIC_BASE_URL_META || "";
  const artBase = process.env.R2_PUBLIC_BASE_URL_ART || "";
  const transcriptBase =
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
    process.env.R2_PUBLIC_BASE_URL_RAW_TEXT ||
    "";
  const siteBaseUrl = process.env.SITE_BASE_URL || "https://jonathan-harris.online";
  const transcriptHtmlBase =
    process.env.PODCAST_TRANSCRIPT_HTML_BASE_URL ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML ||
    joinUrl(siteBaseUrl, "transcripts") ||
    process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
    "";

  const metaUrl = metaBase ? `${metaBase}/${metaKey}` : "";

  let existing = {};
  try {
    if (metaUrl) {
      const res = await fetchWithTimeout(metaUrl, { timeout: PODCAST_FETCH_TIMEOUT_MS });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        existing = await res.json();
      }
    }
  } catch {}

  const sessionDate =
    existing?.session?.date ||
    existing?.createdAt ||
    new Date().toISOString();

  let duration = null;
  try {
    const { stdout } = await new Promise((resolve) => {
      const ff = spawn("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        finalPath,
      ]);
      let out = "";
      ff.stdout.on("data", (d) => (out += d.toString()));
      ff.on("close", () => resolve({ stdout: out }));
    });

    const d = parseFloat(stdout.trim());
    if (!isNaN(d)) duration = d;
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
    artworkPrompt: existing.artworkPrompt || "",
    episodeNumber: existing.episodeNumber || 1,
    episodeSlug,
    episodePageUrl,
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
    fileSize: finalBuffer.length,
    pubDate: new Date(sessionDate).toUTCString(),
  };

  await safePutObject(
    "meta",
    metaKey,
    Buffer.from(JSON.stringify(updated, null, 2)),
    "application/json"
  );

  return { metaKey, metaUrl };
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
    const publicBaseEdited = requireEnv("R2_PUBLIC_BASE_URL_EDITED_AUDIO");
    const editedUrl = `${publicBaseEdited}/${sessionId}_edited.mp3`;

    info("🎚 Fetching edited audio from R2", { sessionId, editedUrl, timeoutMs: PODCAST_FETCH_TIMEOUT_MS });

    const res = await fetchWithTimeout(editedUrl, { timeout: PODCAST_FETCH_TIMEOUT_MS });
    if (!res.ok) throw new Error("Failed to fetch edited audio from R2");

    editedBuffer = Buffer.from(await res.arrayBuffer());
  }

  info("🎧 Retrieved edited audio", { sessionId, source: editedSource });

  const intro = `${TMP_DIR}/${sessionId}_intro.mp3`;
  const main = `${TMP_DIR}/${sessionId}_main.mp3`;
  const outro = `${TMP_DIR}/${sessionId}_outro.mp3`;
  const final = `${TMP_DIR}/${sessionId}_final.mp3`;
  const list = `${TMP_DIR}/${sessionId}_list.txt`;
  const tempFiles = [intro, main, outro, final, list];

  try {
    fs.writeFileSync(main, editedBuffer);

    async function dl(url, dest) {
      const r = await fetchWithTimeout(url, { timeout: PODCAST_FETCH_TIMEOUT_MS });
      if (!r.ok) throw new Error(`Download failed: ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    }

    await dl(introUrl, intro);
    await dl(outroUrl, outro);

    fs.writeFileSync(
      list,
      `file '${intro}'\nfile '${main}'\nfile '${outro}'\n`
    );

    await runFFmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", final]);

    const finalBuffer = fs.readFileSync(final);

    const podcastKey = `${sessionId}.mp3`;
    const podcastUrl = `${publicBasePodcast}/${podcastKey}`;

    await safePutObject("podcast", podcastKey, finalBuffer, "audio/mpeg");

    info("📡 Uploaded final podcast", { sessionId, podcastKey });

    await updateMetaFile(sessionId, finalBuffer, final, podcastUrl, {
      artUrl,
      imageGenerationStatus,
      imageGenerationError,
    });

    return {
      buffer: finalBuffer,
      key: podcastKey,
      url: podcastUrl,
      artUrl,
      imageGenerationStatus,
      imageGenerationError,
    };
  } finally {
    cleanup(tempFiles);
  }
}

export default podcastProcessor;
