#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_REFERENCE_PATTERN = /^\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}$/;
const LOOSE_SECRET_REFERENCE_PATTERN = /^\{\{\s*secret\.([^}]+?)\s*\}\}$/;
const BLOTATO_TEMPLATE_UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BLOTATO_DEFAULT_TEMPLATE_PATH =
  "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";

const NUMERIC_ENVS = new Set([
  "PHASE3_AUTOPUBLISH_MIN_SCORE",
  "PHASE3_SOURCE_MIN_CHARS",
  "PHASE3_MAX_SENTENCE_WORDS",
  "PHASE3_MAX_PODCAST_SENTENCE_WORDS",
  "BLOTATO_VIDEO_POLL_ATTEMPTS",
  "BLOTATO_VIDEO_POLL_INTERVAL_MS",
  "BLOTATO_POST_POLL_ATTEMPTS",
  "BLOTATO_POST_POLL_INTERVAL_MS",
  "BLOTATO_TIMEOUT_MS",
  "BLOTATO_NEWS_SHORT_MAX_TOKENS",
  "BLOTATO_FACEBOOK_PAGE_ID",
  "BLOTATO_FACEBOOK_ACCOUNT_ID",
  "BLOTATO_TIKTOK_ACCOUNT_ID",
  "BLOTATO_NEWS_DURATION_SECONDS",
  "BLOTATO_VIDEO_SCENE_COUNT",
  "BLOTATO_API_RETRY_ATTEMPTS",
  "BLOTATO_API_RETRY_MAX_MS",
  "BLOTATO_KEEPALIVE_INTERVAL_MS",
  "BLOTATO_PUBLISH_STAGGER_MS",
  "BLOTATO_SCRIPT_TIMEOUT_MS",
]);

const POSITIVE_INTEGER_ENVS = new Set([
  "PHASE3_SOURCE_MIN_CHARS",
  "PHASE3_MAX_SENTENCE_WORDS",
  "PHASE3_MAX_PODCAST_SENTENCE_WORDS",
  "BLOTATO_VIDEO_POLL_ATTEMPTS",
  "BLOTATO_VIDEO_POLL_INTERVAL_MS",
  "BLOTATO_POST_POLL_ATTEMPTS",
  "BLOTATO_POST_POLL_INTERVAL_MS",
  "BLOTATO_TIMEOUT_MS",
  "BLOTATO_NEWS_SHORT_MAX_TOKENS",
  "BLOTATO_FACEBOOK_PAGE_ID",
  "BLOTATO_FACEBOOK_ACCOUNT_ID",
  "BLOTATO_TIKTOK_ACCOUNT_ID",
  "BLOTATO_NEWS_DURATION_SECONDS",
  "BLOTATO_VIDEO_SCENE_COUNT",
  "BLOTATO_API_RETRY_ATTEMPTS",
  "BLOTATO_API_RETRY_MAX_MS",
  "BLOTATO_KEEPALIVE_INTERVAL_MS",
  "BLOTATO_PUBLISH_STAGGER_MS",
  "BLOTATO_SCRIPT_TIMEOUT_MS",
]);

const BOOLEAN_ENVS = new Set([
  "ALLOW_EPHEMERAL_STATE",
  "BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS",
  "BLOTATO_INSTAGRAM_SHARE_TO_FEED",
  "BLOTATO_RSS_PREFER_R2",
  "ONEUP_VALIDATE_TARGET_ACCOUNTS",
  "BLOTATO_TEMPLATE_VERIFY",
  "BLOTATO_TEMPLATE_AUTO_DISCOVERY",
  "BLOTATO_NEWS_JSON_RESPONSE_FORMAT",
  "BLOTATO_STEP0_PREFLIGHT_ENABLED",
  "BLOTATO_PREFLIGHT_REQUIRE_LISTED_ACCOUNTS",
  "BLOTATO_PREFLIGHT_REQUIRE_LISTED_SUBACCOUNTS",
  "BLOTATO_KEEPALIVE_ENABLED",
  "BLOTATO_PUBLISH_SEQUENTIAL",
  "BLOTATO_REQUIRE_ALL_CHANNELS",
  "BLOTATO_ALLOW_PUBLIC_PUBLISH_HOOKS",
  "CLOUDFLARE_PURGE_ALLOW_PUBLIC",
  "BLOTATO_TIKTOK_DISABLED_COMMENTS",
  "BLOTATO_TIKTOK_DISABLED_DUET",
  "BLOTATO_TIKTOK_DISABLED_STITCH",
  "BLOTATO_TIKTOK_IS_BRANDED_CONTENT",
  "BLOTATO_TIKTOK_IS_YOUR_BRAND",
  "BLOTATO_TIKTOK_IS_AI_GENERATED",
]);

const URL_ENVS = new Set([
  "APP_URL",
  "BLOTATO_API_BASE",
  "BLOTATO_NEWS_RSS_URL",
  "BLOG_FALLBACK_IMAGE_URL",
  "BLOG_SOCIAL_FALLBACK_IMAGE_URL",
  "BLOG_SOCIAL_PUBLIC_BASE_URL",
  "BLOG_SOCIAL_PUBLIC_POSTS_BASE_URL",
  "FEED_URL",
  "GOOGLE_SHEET_ID",
  "ONEUP_API_BASE",
  "OPENROUTER_API_BASE",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_SITE_URL",
  "PODCAST_EPISODE_BASE_URL",
  "PODCAST_FALLBACK_IMAGE_URL",
  "PODCAST_FUNDING_URL",
  "PODCAST_IMAGE_URL",
  "PODCAST_INTRO_URL",
  "PODCAST_LINK",
  "PODCAST_OUTRO_URL",
  "PODCAST_RSS_FEED_URL",
  "PODCAST_TRANSCRIPT_HTML_BASE_URL",
  "R2_ENDPOINT",
  "R2_PUBLIC_BASE_URL_ART",
  "R2_PUBLIC_BASE_URL_AUDITS",
  "R2_PUBLIC_BASE_URL_HIVE_SKILLS",
  "R2_PUBLIC_BASE_URL_BLOG",
  "R2_PUBLIC_BASE_URL_BLOG_IMAGES",
  "R2_PUBLIC_BASE_URL_BLOG_RSS",
  "R2_PUBLIC_BASE_URL_BRAND_ASSETS",
  "R2_PUBLIC_BASE_URL_CHUNKS",
  "R2_PUBLIC_BASE_URL_EDITED_AUDIO",
  "R2_PUBLIC_BASE_URL_MERGE",
  "R2_PUBLIC_BASE_URL_META",
  "R2_PUBLIC_BASE_URL_META_SYSTEM",
  "R2_PUBLIC_BASE_URL_PODCAST",
  "R2_PUBLIC_BASE_URL_PODCAST_RSS",
  "R2_PUBLIC_BASE_URL_RAW_TEXT",
  "R2_PUBLIC_BASE_URL_RSS",
  "R2_PUBLIC_BASE_URL_TRANSCRIPT",
  "R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML",
  "SITE_BASE_URL",
]);
const VALID_BOOLEAN_VALUES = new Set(["1", "0", "true", "false", "yes", "no", "on", "off"]);
const VALID_STATE_BACKENDS = new Set(["auto", "r2", "local", "file", "filesystem"]);
const VALID_CHANNELS = new Set(["instagram", "youtube", "tiktok", "facebook", "linkedin", "threads", "twitter"]);
const VALID_YOUTUBE_PRIVACY = new Set(["public", "private", "unlisted"]);
const VALID_RSS_PICK_MODES = new Set(["latest", "random"]);

function clean(value) {
  return String(value ?? "").trim();
}

function isCommentOrBlank(line) {
  const trimmed = clean(line);
  return !trimmed || trimmed.startsWith("#");
}

export function parseEnvLines(raw) {
  const entries = [];
  const errors = [];
  const seen = new Map();

  String(raw || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const lineNumber = index + 1;
      if (isCommentOrBlank(line)) return;

      const eqIndex = line.indexOf("=");
      if (eqIndex < 1) {
        errors.push({ line: lineNumber, key: null, message: "Env line must use KEY=VALUE format" });
        return;
      }

      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      entries.push({ line: lineNumber, key, value, raw: line });

      if (!ENV_KEY_PATTERN.test(key)) {
        errors.push({ line: lineNumber, key, message: `Invalid env key: ${key}` });
      }

      if (seen.has(key)) {
        errors.push({ line: lineNumber, key, message: `Duplicate env key also seen on line ${seen.get(key)}` });
      } else {
        seen.set(key, lineNumber);
      }
    });

  return { entries, errors };
}

function validateNotTruncated({ key, value, line }, errors) {
  const raw = clean(value);
  if (!raw.includes("...")) return;

  errors.push({
    line,
    key,
    message:
      key === "BLOTATO_NEWS_TEMPLATE_ID"
        ? `${key} is truncated. Use the full value: ${BLOTATO_DEFAULT_TEMPLATE_PATH}`
        : `${key} appears truncated because it contains literal ...; use the verified full value`,
  });
}

function validateSecretReference({ key, value, line }, errors) {
  const cleaned = clean(value);
  if (!LOOSE_SECRET_REFERENCE_PATTERN.test(cleaned)) return;

  if (!SECRET_REFERENCE_PATTERN.test(cleaned)) {
    errors.push({
      line,
      key,
      message:
        `Invalid Koyeb secret reference for ${key}; use {{ secret.SECRET_NAME }} or {{secret.SECRET_NAME}} with letters, numbers or underscores only`,
    });
  }
}

function validateNumber({ key, value, line }, errors) {
  if (!NUMERIC_ENVS.has(key)) return;
  const raw = clean(value);
  if (!raw) return;
  const number = Number(raw);

  if (!Number.isFinite(number)) {
    errors.push({ line, key, message: `${key} must be numeric` });
    return;
  }

  if (POSITIVE_INTEGER_ENVS.has(key) && (!Number.isInteger(number) || number <= 0)) {
    errors.push({ line, key, message: `${key} must be a positive integer` });
  }

  if (key === "PHASE3_AUTOPUBLISH_MIN_SCORE" && (number < 0 || number > 100)) {
    errors.push({ line, key, message: `${key} must be between 0 and 100` });
  }

  if (key === "BLOTATO_NEWS_DURATION_SECONDS" && (number < 30 || number > 90)) {
    errors.push({ line, key, message: `${key} must be between 30 and 90` });
  }
}

function validateBoolean({ key, value, line }, errors) {
  if (!BOOLEAN_ENVS.has(key)) return;
  if (!VALID_BOOLEAN_VALUES.has(clean(value).toLowerCase())) {
    errors.push({ line, key, message: `${key} must be a boolean-like value` });
  }
}

function validateUrl({ key, value, line }, errors) {
  if (!URL_ENVS.has(key)) return;
  const raw = clean(value);
  if (!raw) return;

  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) {
      errors.push({ line, key, message: `${key} must use http or https` });
    }

    if (parsed.hostname && !/^[A-Za-z0-9.-]+$/.test(parsed.hostname)) {
      errors.push({ line, key, message: `${key} has an invalid URL hostname` });
    }
  } catch {
    errors.push({ line, key, message: `${key} must be a valid URL` });
  }
}

function validateTemplate({ key, value, line }, errors) {
  if (key !== "BLOTATO_NEWS_TEMPLATE_ID") return;
  const raw = clean(value);
  if (!raw) return;

  if (!BLOTATO_TEMPLATE_UUID_PATTERN.test(raw)) {
    errors.push({ line, key, message: `${key} must include a Blotato template UUID` });
    return;
  }

  if (raw.includes("/") && !raw.startsWith("/base/v2/")) {
    errors.push({
      line,
      key,
      message: `${key} must be either a bare Blotato template UUID or a full /base/v2/... template path`,
    });
  }
}

function validateEnum({ key, value, line }, errors) {
  const raw = clean(value).toLowerCase();
  if (!raw) return;

  if (key === "STATE_BACKEND" && !VALID_STATE_BACKENDS.has(raw)) {
    errors.push({ line, key, message: `${key} must be one of: ${[...VALID_STATE_BACKENDS].join(", ")}` });
  }

  if (key === "BLOTATO_YOUTUBE_PRIVACY_STATUS" && !VALID_YOUTUBE_PRIVACY.has(raw)) {
    errors.push({ line, key, message: `${key} must be one of: ${[...VALID_YOUTUBE_PRIVACY].join(", ")}` });
  }

  if (key === "BLOTATO_RSS_PICK_MODE" && !VALID_RSS_PICK_MODES.has(raw)) {
    errors.push({ line, key, message: `${key} must be one of: ${[...VALID_RSS_PICK_MODES].join(", ")}` });
  }

  if (key === "BLOTATO_DEFAULT_CHANNELS") {
    const channels = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (!channels.length) {
      errors.push({ line, key, message: `${key} must include at least one channel` });
      return;
    }

    const invalid = channels.filter((channel) => !VALID_CHANNELS.has(channel));
    if (invalid.length) {
      errors.push({ line, key, message: `${key} includes unsupported channel(s): ${invalid.join(", ")}` });
    }
  }
}

export function validateEnvEntries(entries) {
  const errors = [];

  for (const entry of entries) {
    if (clean(entry.value).includes("...")) {
      validateNotTruncated(entry, errors);
      continue;
    }

    validateSecretReference(entry, errors);
    validateNumber(entry, errors);
    validateBoolean(entry, errors);
    validateUrl(entry, errors);
    validateTemplate(entry, errors);
    validateEnum(entry, errors);
  }

  return errors;
}

export function validateEnvObject(env = process.env) {
  const entries = Object.entries(env).map(([key, value]) => ({ key, value, line: null, raw: `${key}=${value}` }));
  return validateEnvEntries(entries);
}

export async function validateEnvFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = parseEnvLines(raw);
  const validationErrors = validateEnvEntries(parsed.entries);
  return {
    entries: parsed.entries,
    errors: [...parsed.errors, ...validationErrors],
  };
}

function formatError(error) {
  const location = error.line ? `line ${error.line}` : "process.env";
  const key = error.key ? ` ${error.key}` : "";
  return `${location}${key}: ${error.message}`;
}

async function main() {
  const filePath = process.argv[2];
  const result = filePath
    ? await validateEnvFile(filePath)
    : { entries: Object.entries(process.env), errors: validateEnvObject(process.env) };

  if (result.errors.length) {
    console.error("❌ Koyeb env doctor found blocking env issue(s):");
    for (const err of result.errors) {
      console.error(` - ${formatError(err)}`);
    }
    process.exit(1);
  }

  console.log(`✅ Koyeb env doctor passed${filePath ? ` for ${filePath}` : ""}`);
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  main().catch((err) => {
    console.error("❌ Koyeb env doctor failed");
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
