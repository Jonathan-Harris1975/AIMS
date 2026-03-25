// deployment-check.js
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

const missing = REQUIRED_ENV_KEYS.filter((key) => {
  const value = process.env[key];
  return value === undefined || String(value).trim() === "";
});

if (missing.length) {
  console.error("❌ Missing required ENV variables:");
  missing.forEach((key) => console.error(`  - ${key}`));
  process.exit(1);
}

console.log("✅ Environment validation passed");
