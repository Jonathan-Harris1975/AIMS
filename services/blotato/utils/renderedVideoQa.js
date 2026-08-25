import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseStructuredJson, strictJsonResponseFormat } from "../../shared/utils/structuredJson.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MIN_SECONDS = Number(process.env.BLOTATO_RENDERED_MIN_SECONDS || 35);
const DEFAULT_MAX_SECONDS = Number(process.env.BLOTATO_RENDERED_MAX_SECONDS || 55);
const DEFAULT_THRESHOLD = Number(process.env.BLOTATO_RENDERED_QA_THRESHOLD || 70);
const DEFAULT_FRAME_COUNT = Math.max(4, Math.min(12, Number(process.env.BLOTATO_RENDERED_QA_FRAMES || 8)));
const DEFAULT_MAX_BYTES = Math.max(10_000_000, Number(process.env.BLOTATO_RENDERED_QA_MAX_BYTES || 120_000_000));
const RENDERED_VIDEO_QA_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    hookPerformance: { type: "number" },
    sourceRelevance: { type: "number" },
    sceneAlignment: { type: "number" },
    continuity: { type: "number" },
    visualProgression: { type: "number" },
    visualQuality: { type: "number" },
    captionLegibility: { type: "number" },
    defects: { type: "array", items: { type: "string" } },
    hardDefects: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    recommendation: { type: "string" },
  },
  required: [
    "score", "hookPerformance", "sourceRelevance", "sceneAlignment", "continuity",
    "visualProgression", "visualQuality", "captionLegibility", "defects", "hardDefects",
    "summary", "recommendation",
  ],
});

function compact(value = "", max = 3000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on", "y"].includes(value)) return true;
  if (["0", "false", "no", "off", "n"].includes(value)) return false;
  return fallback;
}

function score(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => compact(item, 320)).filter(Boolean).slice(0, 15) : [];
}

function parseRate(value = "") {
  const [numerator, denominator = "1"] = String(value || "").split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0 ? top / bottom : 0;
}

export function evaluateRenderedVideoTechnical(metadata = {}, {
  minSeconds = DEFAULT_MIN_SECONDS,
  maxSeconds = DEFAULT_MAX_SECONDS,
} = {}) {
  const durationSeconds = Number(metadata.durationSeconds || 0);
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const fps = Number(metadata.fps || 0);
  const aspect = height > 0 ? width / height : 0;
  const defects = [];
  const warnings = [];

  if (!durationSeconds || durationSeconds < minSeconds || durationSeconds > maxSeconds) {
    defects.push(`Finished duration ${durationSeconds ? durationSeconds.toFixed(2) : "unknown"}s is outside ${minSeconds}-${maxSeconds}s.`);
  }
  if (width < 720 || height < 1280) defects.push(`Finished resolution ${width}x${height} is below 720x1280.`);
  if (!aspect || Math.abs(aspect - 9 / 16) > 0.035) defects.push(`Finished aspect ratio ${aspect ? aspect.toFixed(3) : "unknown"} is not vertical 9:16.`);
  if (fps > 0 && fps < 24) warnings.push(`Finished frame rate is low (${fps.toFixed(2)} fps).`);

  return {
    pass: defects.length === 0,
    durationSeconds,
    width,
    height,
    fps: Number(fps.toFixed(3)),
    aspectRatio: aspect ? Number(aspect.toFixed(4)) : 0,
    minSeconds,
    maxSeconds,
    defects,
    warnings,
  };
}

export async function probeRenderedVideo(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { maxBuffer: 5_000_000 });
  const payload = JSON.parse(stdout);
  const video = (payload.streams || []).find((stream) => stream.codec_type === "video") || {};
  return {
    durationSeconds: Number(video.duration || payload.format?.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: parseRate(video.avg_frame_rate || video.r_frame_rate),
    codec: compact(video.codec_name || "", 80),
    format: compact(payload.format?.format_name || "", 120),
    sizeBytes: Number(payload.format?.size || 0),
  };
}

async function downloadVideo(mediaUrl, filePath, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  const response = await fetchWithTimeout(mediaUrl, {
    timeout: Number(process.env.BLOTATO_RENDERED_QA_DOWNLOAD_TIMEOUT_MS || 120_000),
    headers: { accept: "video/mp4,video/*;q=0.9,*/*;q=0.1" },
  });
  if (!response.ok) {
    const err = new Error(`Rendered video download failed with status ${response.status}`);
    err.statusCode = 502;
    throw err;
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    const err = new Error(`Rendered video is too large for QA (${declared}/${maxBytes} bytes)`);
    err.statusCode = 413;
    throw err;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error(`Rendered video exceeded QA download limit (${total}/${maxBytes} bytes)`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  await writeFile(filePath, Buffer.concat(chunks));
  return total;
}

export function renderedVideoSampleTimes(durationSeconds, frameCount = DEFAULT_FRAME_COUNT) {
  const safeDuration = Math.max(1, Number(durationSeconds || 1));
  const count = Math.max(6, Math.min(12, Number(frameCount || DEFAULT_FRAME_COUNT)));
  const early = [0.25, 1.15, 2.65].filter((time) => time < safeDuration - 0.1);
  const remaining = Math.max(0, count - early.length);
  const laterStart = Math.min(Math.max(3.5, safeDuration * 0.1), Math.max(0, safeDuration - 0.2));
  const later = Array.from({ length: remaining }, (_, index) => {
    if (remaining <= 1) return Math.max(laterStart, safeDuration * 0.55);
    const fraction = index / (remaining - 1);
    return laterStart + ((Math.max(laterStart, safeDuration - 0.2) - laterStart) * fraction);
  });
  return [...new Set([...early, ...later].map((time) => Number(Math.min(safeDuration - 0.05, Math.max(0, time)).toFixed(3))))].slice(0, count);
}

async function createContactSheet(filePath, outputPath, { durationSeconds, frameCount = DEFAULT_FRAME_COUNT } = {}) {
  const times = renderedVideoSampleTimes(durationSeconds, frameCount);
  const columns = times.length <= 8 ? 4 : 6;
  const rows = Math.ceil(times.length / columns);
  const frameDir = path.join(path.dirname(outputPath), "frames");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(frameDir, { recursive: true }));

  for (const [index, time] of times.entries()) {
    const framePath = path.join(frameDir, `frame-${String(index).padStart(2, "0")}.jpg`);
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(time),
      "-i", filePath,
      "-frames:v", "1",
      "-vf", "scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2",
      "-q:v", "3",
      framePath,
    ], { maxBuffer: 10_000_000 });
  }

  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", "1",
    "-i", path.join(frameDir, "frame-%02d.jpg"),
    "-vf", `tile=${columns}x${rows}:nb_frames=${times.length}:padding=4:margin=4`,
    "-frames:v", "1",
    "-q:v", "3",
    outputPath,
  ], { maxBuffer: 10_000_000 });
}

export function buildRenderedVideoQaPrompt({ pack = {}, article = {}, technical = {} } = {}) {
  const scenes = Array.isArray(pack.scenes)
    ? pack.scenes.map((scene, index) => `${index + 1}. VO: ${compact(scene?.script, 260)} | planned visual: ${compact(scene?.mediaSource, 500)}`).join("\n")
    : "";
  return [
    "Audit the finished vertical social video represented by this chronological contact sheet.",
    "This is post-render quality control. Judge the actual frames, not the script plan or prompt compliance.",
    "The video must finish within 35-55 seconds and normally targets roughly 45 seconds. Ordinary subtitle captions are expected; do not fail legitimate readable captions. Do fail gibberish, cropped/unreadable captions, accidental logos or image-generated pseudo-text.",
    "The first three cells are deliberately sampled from the opening three seconds. Give the hook/scroll-stopper at least 40% of the overall judgement: movement, specificity, visual tension, immediate source relevance and whether it stops a rapid scroll.",
    "Give special weight to source relevance, scene-to-narration fit, visual progression and whether the sequence tells one coherent story.",
    "Penalise repeated static portraits, repeated desk scenes, arbitrary cards/board games/miniatures/toys/puzzles, generic AI imagery, irrelevant lifestyle imagery, weak change between scenes and visuals that could illustrate any article.",
    "A technically polished but off-topic video must score poorly. A static generic opening must cap the total score below 60 even if later frames improve.",
    `Source title: ${compact(article.title, 300)}`,
    `Source summary: ${compact(article.summary || article.description, 1000)}`,
    `Hook: ${compact(pack.hook, 300)}`,
    `Script: ${compact(pack.script, 1800)}`,
    `Technical metadata: ${JSON.stringify(technical)}`,
    `Scene plan:\n${scenes}`,
    "Return JSON only with exactly these keys:",
    '{"score":0,"hookPerformance":0,"sourceRelevance":0,"sceneAlignment":0,"continuity":0,"visualProgression":0,"visualQuality":0,"captionLegibility":0,"defects":[],"hardDefects":[],"summary":"","recommendation":""}',
    "Scores are 0-100. Hard defects include seriously off-topic visuals, repeated generic metaphor props, broken/unreadable captions, severe generated anatomy, logos/watermarks, or a sequence that does not match the source story.",
  ].join("\n");
}

export function normaliseRenderedVideoQa(raw, {
  threshold = DEFAULT_THRESHOLD,
  technical = {},
} = {}) {
  const parsed = typeof raw === "string" ? parseStructuredJson(raw, "Blotato rendered-video QA response") : raw;
  const defects = stringArray(parsed?.defects);
  const hardDefects = stringArray(parsed?.hardDefects);
  const result = {
    score: score(parsed?.score),
    threshold: Math.max(1, Math.min(100, Number(threshold || DEFAULT_THRESHOLD))),
    hookPerformance: score(parsed?.hookPerformance),
    sourceRelevance: score(parsed?.sourceRelevance),
    sceneAlignment: score(parsed?.sceneAlignment),
    continuity: score(parsed?.continuity),
    visualProgression: score(parsed?.visualProgression),
    visualQuality: score(parsed?.visualQuality),
    captionLegibility: score(parsed?.captionLegibility),
    defects,
    hardDefects,
    summary: compact(parsed?.summary, 900),
    recommendation: compact(parsed?.recommendation, 900),
    technical,
  };
  result.pass = Boolean(
    technical?.pass !== false
      && hardDefects.length === 0
      && result.score >= result.threshold
      && result.hookPerformance >= 65
      && result.sourceRelevance >= 70
      && result.sceneAlignment >= 65
      && result.visualProgression >= 65
      && result.captionLegibility >= 70
  );
  return result;
}

export function buildRenderedVideoQaError(result = {}) {
  const reasons = [
    ...(result.technical?.defects || []),
    ...(result.hardDefects || []),
    ...(result.defects || []),
  ].slice(0, 10);
  const err = new Error(`Blotato finished-video QA failed (${result.score || 0}/${result.threshold || DEFAULT_THRESHOLD}): ${reasons.join(" | ") || "finished render did not meet visual thresholds"}`);
  err.statusCode = 422;
  err.renderedVideoQa = result;
  return err;
}

export async function reviewRenderedVideo({
  mediaUrl,
  pack = {},
  article = {},
  sessionId = "blotato-rendered-qa",
  frameCount = DEFAULT_FRAME_COUNT,
} = {}) {
  if (!mediaUrl) throw new Error("Rendered video QA requires a media URL.");
  const enabled = boolEnv("BLOTATO_RENDERED_QA_ENABLED", true);
  if (!enabled) return { pass: true, skipped: true, reason: "disabled" };

  const directory = await mkdtemp(path.join(process.env.APP_TMP_DIR || os.tmpdir(), "blotato-rendered-qa-"));
  const videoPath = path.join(directory, "render.mp4");
  const contactSheetPath = path.join(directory, "contact-sheet.jpg");

  try {
    const downloadedBytes = await downloadVideo(mediaUrl, videoPath);
    const metadata = await probeRenderedVideo(videoPath);
    const technical = evaluateRenderedVideoTechnical(metadata);
    technical.downloadedBytes = downloadedBytes;
    if (!technical.pass) {
      return {
        pass: false,
        score: 0,
        threshold: DEFAULT_THRESHOLD,
        hookPerformance: 0,
        sourceRelevance: 0,
        sceneAlignment: 0,
        continuity: 0,
        visualProgression: 0,
        visualQuality: 0,
        captionLegibility: 0,
        defects: technical.defects,
        hardDefects: technical.defects,
        summary: "Finished render failed technical validation before visual review.",
        recommendation: "Regenerate with the configured vertical template and keep the finished render inside 35-55 seconds.",
        technical,
      };
    }

    await createContactSheet(videoPath, contactSheetPath, { durationSeconds: metadata.durationSeconds, frameCount });
    const contactSheet = await readFile(contactSheetPath);
    const { resilientRequest } = await import("../../shared/utils/ai-service.js");
    const maxJsonAttempts = Math.max(1, Math.min(3, Number(process.env.BLOTATO_RENDERED_QA_JSON_ATTEMPTS || 2)));
    let lastQaError = null;
    for (let attempt = 1; attempt <= maxJsonAttempts; attempt += 1) {
      try {
        const raw = await resilientRequest("blotatoVisualQa", {
          sessionId: `${sessionId}-json-${attempt}`,
          max_tokens: 1400,
          temperature: attempt === 1 ? 0.1 : 0,
          reasoning: { effort: "minimal" },
          response_format: strictJsonResponseFormat("blotato_rendered_video_qa", RENDERED_VIDEO_QA_SCHEMA),
          messages: [{
            role: "user",
            content: [
              { type: "text", text: `${buildRenderedVideoQaPrompt({ pack, article, technical })}${attempt > 1 ? "\nYour previous response was invalid JSON. Return one complete JSON object only." : ""}` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${contactSheet.toString("base64")}` } },
            ],
          }],
        });
        return normaliseRenderedVideoQa(raw, { technical });
      } catch (error) {
        lastQaError = error;
      }
    }

    if (boolEnv("BLOTATO_RENDERED_QA_INFRASTRUCTURE_FALLBACK", true)) {
      return {
        pass: true,
        skipped: true,
        reason: "qa_infrastructure_fallback",
        error: compact(lastQaError?.message || lastQaError, 500),
        score: null,
        threshold: DEFAULT_THRESHOLD,
        technical,
        defects: [],
        hardDefects: [],
      };
    }
    throw lastQaError || new Error("Rendered-video QA returned no valid structured result.");
  } catch (error) {
    if (boolEnv("BLOTATO_RENDERED_QA_INFRASTRUCTURE_FALLBACK", true)) {
      return {
        pass: true,
        skipped: true,
        reason: "qa_infrastructure_fallback",
        error: compact(error?.message || error, 500),
        score: null,
        threshold: DEFAULT_THRESHOLD,
        defects: [],
        hardDefects: [],
      };
    }
    if (!boolEnv("BLOTATO_RENDERED_QA_REQUIRED", true)) {
      return { pass: true, skipped: true, reason: "qa_unavailable", error: compact(error?.message || error, 500) };
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export default {
  buildRenderedVideoQaError,
  buildRenderedVideoQaPrompt,
  evaluateRenderedVideoTechnical,
  normaliseRenderedVideoQa,
  probeRenderedVideo,
  reviewRenderedVideo,
};
