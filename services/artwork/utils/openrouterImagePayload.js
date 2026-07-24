const DEFAULT_ARTWORK_MODALITIES = ["image", "text"];
const ALLOWED_MODALITIES = new Set(["image", "text"]);

function envFlagEnabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function parseModalities(raw) {
  const values = String(raw || "")
    .split(/[,+\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, array) => ALLOWED_MODALITIES.has(value) && array.indexOf(value) === index);

  return values.length ? values : [...DEFAULT_ARTWORK_MODALITIES];
}

function pickFirstEnv(...names) {
  for (const name of names.filter(Boolean)) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

export function getArtworkModalities() {
  return parseModalities(process.env.OPENROUTER_ARTWORK_MODALITIES || process.env.ARTWORK_MODALITIES);
}

export function getArtworkImageConfig(mode = "podcast") {
  const configuredAspectRatio = mode === "blog"
    ? pickFirstEnv("BLOG_ARTWORK_ASPECT_RATIO", "ARTWORK_IMAGE_ASPECT_RATIO")
    : pickFirstEnv("PODCAST_ARTWORK_ASPECT_RATIO", "ARTWORK_IMAGE_ASPECT_RATIO");
  const quality = pickFirstEnv("ARTWORK_IMAGE_QUALITY", "OPENROUTER_ARTWORK_QUALITY");
  const explicitConfig = Boolean(configuredAspectRatio || quality);

  if (!explicitConfig && !envFlagEnabled("ARTWORK_IMAGE_CONFIG_ENABLED", false)) return undefined;
  if (!envFlagEnabled("ARTWORK_IMAGE_CONFIG_ENABLED", true)) return undefined;

  const aspectRatio = configuredAspectRatio || (mode === "blog" ? "16:9" : "1:1");

  const imageConfig = {};
  if (aspectRatio) imageConfig.aspect_ratio = aspectRatio;
  if (quality) imageConfig.quality = quality;

  return Object.keys(imageConfig).length ? imageConfig : undefined;
}

export function buildArtworkChatPayload({ model, instruction, maxTokens, mode = "podcast" } = {}) {
  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: instruction,
          },
        ],
      },
    ],
    modalities: getArtworkModalities(),
    stream: false,
  };

  const safeMaxTokens = Number(maxTokens);
  if (Number.isFinite(safeMaxTokens) && safeMaxTokens > 0) {
    payload.max_tokens = safeMaxTokens;
  }

  const imageConfig = getArtworkImageConfig(mode);
  if (imageConfig) payload.image_config = imageConfig;

  return payload;
}

export function extractBase64Image(result) {
  const images = result?.choices?.[0]?.message?.images;
  if (Array.isArray(images) && images[0]?.image_url?.url) {
    const url = images[0].image_url.url;
    const match = String(url).match(/^data:image\/(?:png|jpeg|jpg|webp);base64,(.+)$/i);
    if (match) return match[1];
  }

  const content = result?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const imageItem = content.find((item) => item?.type === "image" && item.image_url?.url);
    const url = imageItem?.image_url?.url;
    const match = String(url || "").match(/^data:image\/(?:png|jpeg|jpg|webp);base64,(.+)$/i);
    if (match) return match[1];

    const directImageData = content.find((item) => typeof item?.image_data === "string")?.image_data;
    if (directImageData) return directImageData;
  }

  const direct = result?.choices?.[0]?.message?.content?.[0]?.image_data;
  if (direct) return direct;

  const raw = JSON.stringify(result || {});
  const match = raw.match(/data:image\/(?:png|jpeg|jpg|webp);base64,([^"'\\\s]+)/i);
  if (match) return match[1];

  return null;
}

export function safeSnippet(value, maxLength = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function makeArtworkHttpError(status, body, provider) {
  const err = new Error(`Artwork generation failed with ${provider?.modelEnv || provider?.id || "provider"}: ${safeSnippet(body, 300) || status}`);
  err.status = Number(status) || 0;
  err.bodySnippet = safeSnippet(body, 500);
  err.providerId = provider?.id;
  err.modelEnv = provider?.modelEnv;
  err.nonRetryable = [400, 401, 403, 404].includes(err.status);
  return err;
}

export function isTransientArtworkError(err) {
  if (err?.nonRetryable) return false;
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(Number(err?.status))) return true;

  const message = String(err?.message || err || "").toLowerCase();
  return [
    "premature close",
    "socket hang up",
    "econnreset",
    "etimedout",
    "fetch failed",
    "network",
    "request timed out",
    "request aborted",
    "body timeout",
    "terminated",
  ].some((needle) => message.includes(needle));
}

export function artworkRetryDelayMs(attempt) {
  const base = Number(process.env.ARTWORK_RETRY_DELAY_MS || 750) || 750;
  return Math.min(base * Math.max(Number(attempt) || 1, 1), 5_000);
}

export function getArtworkProviderAttempts() {
  const raw = Number(process.env.ARTWORK_PROVIDER_ATTEMPTS || process.env.ARTWORK_PROVIDER_RETRIES || 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(Math.max(Math.floor(raw), 1), 8);
}

export function getArtworkRequestTimeoutMs(fallbackTimeoutMs) {
  const raw = Number(process.env.ARTWORK_REQUEST_TIMEOUT_MS || process.env.ARTWORK_PROVIDER_TIMEOUT_MS || fallbackTimeoutMs);
  if (!Number.isFinite(raw) || raw <= 0) return fallbackTimeoutMs;
  return raw;
}
