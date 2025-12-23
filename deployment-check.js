/**
 * deployment-check.js
 *
 * Purpose:
 * - Validate required environment variables exist
 * - Used ONLY in CI / preflight
 * - Explicitly allowed to read process.env
 */

const REQUIRED_ENV_KEYS = [
  "NODE_ENV",
  "PORT",

  // Core services
  "AWS_REGION",
  "R2_ENDPOINT",
  "R2_BUCKET_PODCAST",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",

  // Podcast
  "PODCAST_TITLE",
  "PODCAST_AUTHOR",
  "PODCAST_LINK",

  // AI / APIs (expand as needed)
  "OPENROUTER_API_BASE",
  "OPENROUTER_API_KEY_CHATGPT"
];

const missing = REQUIRED_ENV_KEYS.filter(
  (key) => !process.env[key] || process.env[key].trim() === ""
);

if (missing.length) {
  console.error("❌ Missing required environment variables:");
  missing.forEach((key) => console.error(`   - ${key}`));
  process.exit(1);
}

console.log("✅ Environment variable check passed");
