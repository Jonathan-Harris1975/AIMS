#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_REFERENCE_PATTERN = /^\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}$/;
const BAD_SECRET_REFERENCE_PATTERN = /^\{\{\s*secret\.([^}]+)\s*\}\}$/;
const BLOTATO_DEFAULT_TEMPLATE_PATH =
  "base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";
const BLOTATO_TEMPLATE_UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const NUMERIC_ENVS = new Set([
  "BLOTATO_TIMEOUT_MS",
  "BLOTATO_NEWS_SHORT_MAX_TOKENS",
  "BLOTATO_VIDEO_POLL_ATTEMPTS",
  "BLOTATO_VIDEO_POLL_INTERVAL_MS",
  "BLOTATO_POST_POLL_ATTEMPTS",
  "BLOTATO_POST_POLL_INTERVAL_MS",
  "PHASE3_AUTOPUBLISH_MIN_SCORE",
  "PHASE3_SOURCE_MIN_CHARS",
  "PHASE3_MAX_SENTENCE_WORDS",
  "PHASE3_MAX_PODCAST_SENTENCE_WORDS",
]);

const BOOLEAN_ENVS = new Set([
  "BLOTATO_RSS_PREFER_R2",
  "BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS",
  "BLOTATO_INSTAGRAM_SHARE_TO_FEED",
  "ALLOW_EPHEMERAL_STATE",
]);

const VALID_BOOLEAN_VALUES = new Set(["1", "0", "true", "false", "yes", "no", "on", "off"]);
const VALID_STATE_BACKENDS = new Set(["auto", "r2", "local", "file", "filesystem"]);
const VALID_RSS_PICK_MODES = new Set(["latest", "random"]);
const VALID_CHANNELS = new Set(["instagram", "youtube", "tiktok", "facebook", "linkedin", "threads", "twitter"]);
const VALID_YOUTUBE_PRIVACY = new Set(["public", "private", "unlisted"]);

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

function validateSecretReference({ key, value, line }, errors) {
  const badSecretMatch = clean(value).match(BAD_SECRET_REFERENCE_PATTERN);
  if (!badSecretMatch) return;

  if (!SECRET_REFERENCE_PATTERN.test(clean(value))) {
    errors.push({
      line,
      key,
      message: `Invalid Koyeb secret reference for ${key}; use {{ secret.SECRET_NAME }} with letters, numbers and underscores only`,
    });
  }
}

function validateNumber({ key, value, line }, errors) {
  if (!NUMERIC_ENVS.has(key)) return;
  const number = Number(clean(value));
  if (!Number.isFinite(number)) {
    errors.push({ line, key, message: `${key} must be numeric` });
  }
}

function validateBoolean({ key, value, line }, errors) {
  if (!BOOLEAN_ENVS.has(key)) return;
  if (!VALID_BOOLEAN_VALUES.has(clean(value).toLowerCase())) {
    errors.push({ line, key, message: `${key} must be a boolean-like value` });
  }
}

function validateBlotatoTemplate({ key, value, line }, errors) {
  if (key !== "BLOTATO_NEWS_TEMPLATE_ID") return;
  const template = clean(value);

  if (!template) return;

  if (template.includes("...")) {
    errors.push({
      line,
      key,
      message:
        `${key} is truncated. Use the full value: ${BLOTATO_DEFAULT_TEMPLATE_PATH}`,
    });
    return;
  }

  if (!BLOTATO_TEMPLATE_UUID_PATTERN.test(template)) {
    errors.push({
      line,
      key,
      message: `${key} must include a Blotato template UUID`,
    });
  }
}

function validateEnum({ key, value, line }, errors) {
  const normalised = clean(value).toLowerCase();
  if (!normalised) return;

  if (key === "STATE_BACKEND" && !VALID_STATE_BACKENDS.has(normalised)) {
    errors.push({ line, key, message: `${key} must be one of: ${[...VALID_STATE_BACKENDS].join(", ")}` });
  }

  if (key === "BLOTATO_RSS_PICK_MODE" && !VALID_RSS_PICK_MODES.has(normalised)) {
    errors.push({ line, key, message: `${key} must be one of: ${[...VALID_RSS_PICK_MODES].join(", ")}` });
  }

  if (key === "BLOTATO_YOUTUBE_PRIVACY_STATUS" && !VALID_YOUTUBE_PRIVACY.has(normalised)) {
    errors.push({ line, key, message: `${key} must be one of: ${[...VALID_YOUTUBE_PRIVACY].join(", ")}` });
  }

  if (key === "BLOTATO_DEFAULT_CHANNELS") {
    const channels = normalised.split(",").map((item) => item.trim()).filter(Boolean);
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
    validateSecretReference(entry, errors);
    validateNumber(entry, errors);
    validateBoolean(entry, errors);
    validateBlotatoTemplate(entry, errors);
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
