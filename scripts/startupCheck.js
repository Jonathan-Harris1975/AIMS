// scripts/startupCheck.js
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { info, error, debug } from "../logger.js";

const requiredRouteModules = [
  "../routes/index.js",
  "../services/script/routes/index.js",
  "../services/tts/routes/tts.js",
  "../services/podcast/index.js",
  "../services/artwork/index.js",
  "../services/outreach/routes/index.js",
  "../services/blog/index.js",
];

async function assertImportable(modulePath) {
  await import(modulePath);
}

async function assertBinaryExists(binaryName) {
  const candidates = [
    `/usr/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }

  throw new Error(`${binaryName} binary not found in standard runtime paths`);
}

try {
  info("🟩 startupCheck.js reached — container runtime confirmed!");
  debug("---------------------------------------------");
  debug(`📂 Working directory: ${process.cwd()}`);
  debug(`📦 Node version: ${process.version}`);
  debug("📦 Module type: module (from package.json)");

  const ffmpegPath = await assertBinaryExists("ffmpeg");
  const ffprobePath = await assertBinaryExists("ffprobe");

  for (const modulePath of requiredRouteModules) {
    await assertImportable(modulePath);
  }

  const warnings = [];
  if (!process.env.PORT) warnings.push("PORT not set; default server port 3000 will be used");
  if (!process.env.R2_ENDPOINT) warnings.push("R2_ENDPOINT missing; R2-backed features may fail");
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    warnings.push("R2 credentials missing; storage-backed features may fail");
  }

  debug(`🎬 ffmpeg: ${ffmpegPath}`);
  debug(`🎬 ffprobe: ${ffprobePath}`);
  for (const warning of warnings) {
    info(`⚠️ ${warning}`);
  }

  debug("---------------------------------------------");
  info("🏁 Environment check completed successfully.");
  process.exit(0);
} catch (err) {
  error("❌ Startup check failed", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
}
