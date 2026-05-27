import "./config/loadEnv.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { durableStateEnvHint, hasDurableStateEnv } from "./services/shared/utils/durableStateEnv.js";

const REQUIRED_ENV_KEYS = [
  "NODE_ENV",
  "APP_URL",
  "OPENROUTER_API_BASE",
  "OPENROUTER_API_KEY",
  "AUDIT_CALLBACK_TOKEN",
  "AUDIT_WEBSITE_REPO_OWNER",
  "AUDIT_WEBSITE_REPO_NAME",
  "GITHUB_TOKEN_WEBSITE_AUDITS",
  "RAPIDAPI_HOST",
  "RAPIDAPI_KEY",
  "FEED_URL",
  "PODCAST_TITLE",
  "PODCAST_AUTHOR",
  "PODCAST_DESCRIPTION",
  "PODCAST_LINK",
  "R2_BUCKET_BRAND_ASSETS",
  "R2_PUBLIC_BASE_URL_BRAND_ASSETS",
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
  const hasRemoteStateEnv = hasDurableStateEnv(env);

  if (nodeEnv !== "production" || allowEphemeralState) {
    return null;
  }

  if (!hasRemoteStateEnv || stateBackend === "local") {
    return `Production state backend is not durable. ${durableStateEnvHint()}`;
  }

  return null;
}

export function runBuildSanityCheck() {
  console.log("✅ Build sanity passed: dependency install completed and deployment-check.js loaded");
  return 0;
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
  if (process.argv.includes("--build-sanity")) {
    process.exit(runBuildSanityCheck());
  }

  process.exit(runDeploymentCheck());
}
