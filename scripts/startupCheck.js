import "../config/loadEnv.js";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { info, error, debug } from "../logger.js";
import { durableStateEnvHint, hasDurableStateEnv } from "../services/shared/utils/durableStateEnv.js";
import { assertRelativeImportGraph } from "./utils/relativeImportGraph.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

function assertProductionStateConfig() {
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const allowEphemeralState = parseBoolean(process.env.ALLOW_EPHEMERAL_STATE, false);
  const stateBackend = String(process.env.STATE_BACKEND || "auto").trim().toLowerCase();
  const hasRemoteStateEnv = hasDurableStateEnv(process.env);

  if (nodeEnv !== "production" || allowEphemeralState) {
    return;
  }

  const requireDurableState = parseBoolean(process.env.REQUIRE_DURABLE_STATE, false);
  const explicitlyRemoteState = stateBackend === "r2" || requireDurableState;
  const explicitlyLocalState = ["local", "file", "filesystem"].includes(stateBackend);

  if (explicitlyRemoteState && !hasRemoteStateEnv) {
    throw new Error(`Production state backend is not durable. ${durableStateEnvHint()}`);
  }

  if (explicitlyLocalState) {
    throw new Error(`Production state backend is explicitly local. ${durableStateEnvHint()}`);
  }
}

try {
  info("startupCheck.start", { cwd: process.cwd(), node: process.version });

  const ffmpegPath = await assertBinaryExists("ffmpeg");
  const ffprobePath = await assertBinaryExists("ffprobe");

  const moduleGraph = await assertRelativeImportGraph(projectRoot);

  assertProductionStateConfig();

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

  info("startupCheck.complete", moduleGraph);
  process.exit(0);
} catch (err) {
  error("startupCheck.fail", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
}
