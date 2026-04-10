import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REQUIRED_ENV_KEYS = [
  "NODE_ENV",
  "OPENROUTER_API_BASE",
  "RAPIDAPI_HOST",
  "RAPIDAPI_KEY",
  "FEED_URL",
  "PODCAST_TITLE",
  "PODCAST_AUTHOR",
  "PODCAST_DESCRIPTION",
  "PODCAST_LINK",
];

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function getMissingEnvKeys(env = process.env) {
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || String(value).trim() === "";
  });
}

export function getDurableStateError(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  const allowEphemeralState = parseBoolean(env.ALLOW_EPHEMERAL_STATE, false);
  const stateBackend = String(env.STATE_BACKEND || "auto").trim().toLowerCase();
  const hasRemoteStateEnv = Boolean(
    env.R2_ENDPOINT &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_META_SYSTEM
  );

  if (nodeEnv !== "production" || allowEphemeralState) {
    return null;
  }

  if (!hasRemoteStateEnv || stateBackend === "local") {
    return (
      "Production state backend is not durable. Configure R2_BUCKET_META_SYSTEM with " +
      "STATE_BACKEND=auto or r2, or set ALLOW_EPHEMERAL_STATE=true only if you intentionally " +
      "accept state loss across container restarts."
    );
  }

  return null;
}

export function runDeploymentCheck(env = process.env) {
  const missing = getMissingEnvKeys(env);
  if (missing.length) {
    console.error("❌ Missing required ENV variables:");
    missing.forEach((key) => console.error(`  - ${key}`));
    return 1;
  }

  const durableStateError = getDurableStateError(env);
  if (durableStateError) {
    console.error(`❌ ${durableStateError}`);
    return 1;
  }

  console.log("✅ Environment validation passed");
  return 0;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  process.exit(runDeploymentCheck());
}
