import "dotenv/config";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { info, error, debug } from "../logger.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredEntryModules = [
  "server.js",
  "routes/index.js",
  "services/script/routes/index.js",
  "services/tts/routes/tts.js",
  "services/podcast/index.js",
  "services/artwork/index.js",
  "services/outreach/routes/index.js",
  "services/blog/index.js",
  "services/rss-feed-creator/index.js",
];

const importPattern = /(?:import\s+(?:[^'"()]+?\s+from\s+)?|export\s+[^'"()]+?\s+from\s+|import\()(["'])(\.{1,2}\/[^"'()]+)\1/g;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function assertBinaryExists(binaryName) {
  const candidates = [`/usr/bin/${binaryName}`, `/usr/local/bin/${binaryName}`];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }

  throw new Error(`${binaryName} binary not found in standard runtime paths`);
}

function resolveImport(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [];

  if (path.extname(basePath)) {
    candidates.push(basePath);
  } else {
    candidates.push(`${basePath}.js`, `${basePath}.json`, path.join(basePath, "index.js"));
  }

  return candidates;
}

async function assertModuleGraph(entryRelativePath, visited = new Set()) {
  const absolutePath = path.resolve(projectRoot, entryRelativePath);

  if (visited.has(absolutePath)) return;
  visited.add(absolutePath);

  await access(absolutePath, constants.R_OK);
  const source = await readFile(absolutePath, "utf8");

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[2];
    const candidates = resolveImport(absolutePath, specifier);
    const resolved = [];

    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        resolved.push(candidate);
        break;
      } catch {}
    }

    if (resolved.length === 0) {
      throw new Error(`Missing relative import '${specifier}' referenced from ${path.relative(projectRoot, absolutePath)}`);
    }

    const target = resolved[0];
    if (target.endsWith(".js")) {
      await assertModuleGraph(path.relative(projectRoot, target), visited);
    }
  }
}

function assertProductionStateConfig() {
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const allowEphemeralState = parseBoolean(process.env.ALLOW_EPHEMERAL_STATE, false);
  const stateBackend = String(process.env.STATE_BACKEND || "auto").trim().toLowerCase();
  const hasRemoteStateEnv = Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_META_SYSTEM
  );

  if (nodeEnv !== "production" || allowEphemeralState) {
    return;
  }

  if (!hasRemoteStateEnv || stateBackend === "local") {
    throw new Error(
      "Production state backend is not durable. Configure R2_BUCKET_META_SYSTEM with STATE_BACKEND=auto or r2, or set ALLOW_EPHEMERAL_STATE=true only if you intentionally accept state loss across container restarts."
    );
  }
}

function assertCloudflarePurgeProtection() {
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const cloudflareConfigured = Boolean(
    String(process.env.CF_zone || "").trim() && String(process.env.CF_purge || "").trim()
  );

  if (nodeEnv !== "production" || !cloudflareConfigured) {
    return;
  }

  if (!String(process.env.CLOUDFLARE_PURGE_SHARED_SECRET || "").trim()) {
    throw new Error(
      "Cloudflare purge service is configured but CLOUDFLARE_PURGE_SHARED_SECRET is missing. Refusing to expose an unauthenticated destructive purge route in production."
    );
  }
}

try {
  info("startupCheck.start", { cwd: process.cwd(), node: process.version });

  const ffmpegPath = await assertBinaryExists("ffmpeg");
  const ffprobePath = await assertBinaryExists("ffprobe");

  for (const modulePath of requiredEntryModules) {
    await assertModuleGraph(modulePath);
  }

  assertProductionStateConfig();
  assertCloudflarePurgeProtection();

  const warnings = [];
  if (!process.env.PORT) warnings.push("PORT not set; default server port 3000 will be used");
  if (!process.env.R2_ENDPOINT) warnings.push("R2_ENDPOINT missing; R2-backed features may fail");
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    warnings.push("R2 credentials missing; storage-backed features may fail");
  }

  debug("startupCheck.binaries", { ffmpegPath, ffprobePath });
  for (const warning of warnings) {
    info("startupCheck.warning", { warning });
  }

  info("startupCheck.complete", { entryModulesChecked: requiredEntryModules.length });
  process.exit(0);
} catch (err) {
  error("startupCheck.fail", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
}
