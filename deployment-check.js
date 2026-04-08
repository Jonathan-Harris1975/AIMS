// deployment-check.js
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

export function getMissingEnvKeys(env = process.env) {
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || String(value).trim() === "";
  });
}

export function runDeploymentCheck(env = process.env) {
  const missing = getMissingEnvKeys(env);
  if (missing.length) {
    console.error("❌ Missing required ENV variables:");
    missing.forEach((key) => console.error(`  - ${key}`));
    return 1;
  }

  console.log("✅ Environment validation passed");
  return 0;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  process.exit(runDeploymentCheck());
}
