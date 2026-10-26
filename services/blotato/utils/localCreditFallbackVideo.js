import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFile = promisify(nodeExecFile);
const SLIDE_SECONDS = 8;
const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 1280;
const VIDEO_FPS = 30;

function clean(value, limit = 320) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function escapeHtml(value) {
  return clean(value, 1000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitSentences(value) {
  return clean(value, 1800).split(/(?<=[.!?])\s+/).map((part) => clean(part, 300)).filter(Boolean);
}

export function buildBlotatoCreditFallbackSlides(pack = {}, article = {}) {
  const scenes = Array.isArray(pack.scenes) ? pack.scenes : [];
  const sceneLines = scenes.map((scene) => clean(scene?.script || scene?.narration || scene?.text, 300)).filter(Boolean);
  const scriptLines = splitSentences(pack.script || "");
  const details = sceneLines.length ? sceneLines : scriptLines;
  const title = clean(pack.youtubeTitle || pack.internalTitle || article.title || "AI briefing", 180);
  const hook = clean(pack.hook || title, 220);
  const takeaway = clean(pack.takeaway || pack.angle || details.at(-1) || "Check the source, test the claim and keep human judgement in the loop.", 280);
  const cta = clean(pack.cta || "Follow for practical AI analysis.", 180);
  const points = [
    hook,
    details[0] || takeaway,
    details[1] || takeaway,
    details[2] || takeaway,
    [takeaway, cta].filter(Boolean).join(" "),
  ].filter(Boolean);
  const unique = [...new Set(points)];
  const slides = unique.slice(0, 5);
  while (slides.length < 5) slides.splice(slides.length - 1, 0, takeaway);
  return slides.map((body, index) => ({
    title,
    body: clean(body, 300),
    index: index + 1,
    count: 5,
    source: clean(article.title || "", 120),
  }));
}

export function buildBlotatoCreditFallbackSlideHtml(slide = {}) {
  const isHook = slide.index === 1;
  const kicker = isHook ? "THE AI BRIEFING" : `THE AI BRIEFING · ${slide.index}/${slide.count || 5}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=720,height=1280">
<style>
*{box-sizing:border-box}html,body{width:720px;height:1280px;margin:0;overflow:hidden}
body{font-family:Arial,Helvetica,sans-serif;background:#071426;color:#f8fafc}
.card{position:relative;width:720px;height:1280px;padding:76px 56px 58px;
  display:flex;flex-direction:column;overflow:hidden;
  background:radial-gradient(ellipse at 90% 12%,rgba(20,184,166,.28),transparent 35%),
    radial-gradient(ellipse at 0% 94%,rgba(249,115,22,.2),transparent 34%),
    linear-gradient(152deg,#071426 0%,#10243d 57%,#0b1729 100%)}
.card:before{content:"";position:absolute;inset:22px;border:1px solid rgba(255,255,255,.16);border-radius:30px;pointer-events:none}
.orb{position:absolute;width:250px;height:250px;border-radius:50%;right:-104px;top:360px;background:radial-gradient(circle,rgba(45,212,191,.18),rgba(45,212,191,0) 72%)}
.kicker{position:relative;font-size:20px;line-height:1.3;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#6ee7dc;margin:0 0 46px}
h1{position:relative;font-size:32px;line-height:1.18;letter-spacing:-.025em;margin:0 0 40px;color:#dbeafe;max-height:230px;overflow:hidden}
.rule{position:relative;width:82px;height:5px;border-radius:5px;background:linear-gradient(90deg,#2dd4bf,#fb923c);margin:0 0 42px}
.body{position:relative;font-size:43px;line-height:1.19;font-weight:750;letter-spacing:-.035em;color:#f8fafc;max-height:690px;overflow:hidden}
.source{position:relative;margin-top:28px;color:#9fb0c4;font-size:20px;line-height:1.35;max-height:110px;overflow:hidden}
.footer{position:relative;margin-top:auto;padding-top:36px;border-top:1px solid rgba(255,255,255,.18);display:flex;justify-content:space-between;align-items:center;color:#cbd5e1}
.brand{font-size:18px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.count{font-size:18px;color:#6ee7dc;font-weight:800}
</style>
</head><body><main class="card"><span class="orb"></span>
<p class="kicker">${escapeHtml(kicker)}</p>
<h1>${escapeHtml(slide.title || "AI briefing")}</h1>
<div class="rule"></div>
<div class="body">${escapeHtml(slide.body || "")}</div>
${slide.source ? `<p class="source">Source: ${escapeHtml(slide.source)}</p>` : ""}
<footer class="footer"><span class="brand">Jonathan Harris</span><span class="count">${String(slide.index || 1).padStart(2, "0")} / 05</span></footer>
</main></body></html>`;
}

function safeKeyPart(value) {
  return clean(value, 100).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "scheduled-post";
}

export async function createLocalBlotatoCreditFallbackVideo({
  pack = {},
  article = {},
  sessionId = "",
  scheduleDate = new Date().toISOString().slice(0, 10),
  reason = "paid-render-credit-limit",
  loadChromium = () => import("playwright-core"),
  upload = async (...args) => {
    const { uploadBuffer } = await import("../../shared/utils/r2-client.js");
    return uploadBuffer(...args);
  },
  runFfmpeg = execFile,
  ffmpegPath = "ffmpeg",
} = {}) {
  const slides = buildBlotatoCreditFallbackSlides(pack, article);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aims-blotato-credit-fallback-"));
  let browser;
  try {
    const { chromium } = await loadChromium();
    const executablePath = "/usr/bin/chromium";
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage({ viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT }, deviceScaleFactor: 1 });
    const imagePaths = [];
    for (const slide of slides) {
      await page.setContent(buildBlotatoCreditFallbackSlideHtml(slide), { waitUntil: "load", timeout: 30_000 });
      const imagePath = path.join(tempDir, `slide-${slide.index}.png`);
      await fs.writeFile(imagePath, await page.screenshot({ type: "png", fullPage: false, animations: "disabled" }));
      imagePaths.push(imagePath);
    }

    const outputPath = path.join(tempDir, "scheduled-fallback.mp4");
    const args = ["-hide_banner", "-loglevel", "error", "-y"];
    for (const imagePath of imagePaths) {
      args.push("-loop", "1", "-framerate", String(VIDEO_FPS), "-t", String(SLIDE_SECONDS), "-i", imagePath);
    }
    const filters = imagePaths.map((_, index) =>
      `[${index}:v]fps=${VIDEO_FPS},trim=duration=${SLIDE_SECONDS},setpts=PTS-STARTPTS,setsar=1[v${index}]`
    );
    filters.push(`${imagePaths.map((_, index) => `[v${index}]`).join("")}concat=n=${imagePaths.length}:v=1:a=0,format=yuv420p[outv]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-an", "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "23", "-r", String(VIDEO_FPS), "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-t", String(SLIDE_SECONDS * imagePaths.length), outputPath);
    await runFfmpeg(ffmpegPath, args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    const buffer = await fs.readFile(outputPath);
    if (buffer.length < 20_000) throw new Error("Local Blotato fallback video was unexpectedly small.");

    const objectKey = `blotato-credit-fallback/${scheduleDate}/${safeKeyPart(sessionId)}.mp4`;
    const mediaUrl = await upload("blogImages", objectKey, buffer, "video/mp4", { cacheControl: "public, max-age=31536000, immutable" });
    if (!/^https?:\/\//i.test(String(mediaUrl || ""))) {
      throw new Error("Local Blotato fallback video did not receive a public media URL.");
    }
    return {
      visualId: null,
      dashboardUrl: null,
      mediaUrl,
      templateId: null,
      templateIdCandidates: [],
      rejectedTemplateIds: [],
      creditBudget: { expectedCredits: 0, actualCreditsUsed: 0, source: "local-no-paid-render" },
      localCreditFallback: true,
      fallbackReason: clean(reason, 120),
      localCreditFallbackKey: objectKey,
      runtimeSeconds: SLIDE_SECONDS * imagePaths.length,
    };
  } finally {
    await browser?.close().catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function isBlotatoCreditLimitError(error = {}) {
  const code = String(error.code || "").toLowerCase();
  const message = String(error.message || error || "").toLowerCase();
  return [
    "blotato-daily-paid-render-cap",
    "blotato-monthly-estimated-credit-cap",
    "blotato-expected-credit-budget-cap",
    "insufficient-credits",
    "insufficient_credits",
    "payment-required",
    "payment_required",
    "no-credits",
  ].includes(code) || /(?:insufficient|no) credits|monthly.{0,40}credit.{0,20}cap|daily.{0,30}paid.render cap|payment required/.test(message);
}

export async function renderScheduledBlotatoVideo({
  reservePaidRender,
  renderPaidVideo,
  renderLocalFallback,
} = {}) {
  if (typeof reservePaidRender !== "function" || typeof renderPaidVideo !== "function" || typeof renderLocalFallback !== "function") {
    throw new Error("Scheduled Blotato video render requires paid and fallback render functions.");
  }
  try {
    const reservation = await reservePaidRender();
    return { video: await renderPaidVideo(), reservation, creditFallback: null };
  } catch (error) {
    const creditLimited = isBlotatoCreditLimitError(error);
    const code = String(error.code || (creditLimited ? "provider-credit-limit" : "scheduled-video-render-failed"));
    const video = await renderLocalFallback({ error, code });
    return {
      video: { ...video, localCreditFallback: true },
      reservation: null,
      creditFallback: {
        code: String(error.code || "provider-credit-limit"),
        message: clean(error.message || error, 300),
        scheduledWithoutPaidRender: true,
        creditLimited,
        fallbackReason: code,
      },
    };
  }
}

export const __blotatoLocalFallbackTestHooks = { escapeHtml, safeKeyPart };
