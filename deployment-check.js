/**
 * deployment-check.js
 *
 * CI / preflight environment validation.
 * Explicitly allowed to read process.env.
 * Not application runtime logic.
 */

const REQUIRED_ENV_KEYS = [
  "NODE_ENV",
  "PORT",

  "AWS_REGION",
  "R2_ENDPOINT",
  "R2_BUCKET_PODCAST",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",

  "PODCAST_TITLE",
  "PODCAST_AUTHOR",
  "PODCAST_LINK",

  "OPENROUTER_API_BASE",
  "OPENROUTER_API_KEY_CHATGPT"
];

const missing = REQUIRED_ENV_KEYS.filter(
  (k) => !process.env[k] || process.env[k].trim() === ""
);

if (missing.length) {
  console.error("❌ Missing required environment variables:");
  missing.forEach((k) => console.error(`   - ${k}`));
  process.exit(1);
}

console.log("✅ Environment schema validated");
