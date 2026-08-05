import { getArtworkModelFamily, getDefaultArtworkAspectRatio } from "./artworkModelPrompt.js";

function envFlagEnabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function pickFirstEnv(...names) {
  for (const name of names.filter(Boolean)) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

function modeEnvPrefix(mode = "podcast") {
  return String(mode || "podcast").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

export function getArtworkImageConfig(model, mode = "podcast", { seed } = {}) {
  const family = getArtworkModelFamily(model);
  const prefix = modeEnvPrefix(mode);
  const aspectRatio = pickFirstEnv(
    `${prefix}_ARTWORK_ASPECT_RATIO`,
    mode === "podcast" ? "PODCAST_ARTWORK_ASPECT_RATIO" : undefined,
    mode === "blog" ? "BLOG_ARTWORK_ASPECT_RATIO" : undefined,
    "ARTWORK_IMAGE_ASPECT_RATIO",
  ) || getDefaultArtworkAspectRatio(mode);
  const quality = pickFirstEnv(`${prefix}_ARTWORK_QUALITY`, "ARTWORK_IMAGE_QUALITY", "OPENROUTER_ARTWORK_QUALITY");
  const outputFormat = pickFirstEnv("ARTWORK_OUTPUT_FORMAT") || "png";
  const resolution = pickFirstEnv(`${prefix}_ARTWORK_RESOLUTION`, "ARTWORK_IMAGE_RESOLUTION") || "2K";

  const config = { aspect_ratio: aspectRatio, output_format: outputFormat, n: 1 };
  if (Number.isInteger(seed) && seed >= 0) config.seed = seed;
  if (quality) config.quality = quality;

  // Seedream explicitly supports 1K/2K/4K. Recraft and FLUX endpoints differ,
  // so resolution is omitted for them rather than sending an unsupported knob.
  if (family === "seedream") config.resolution = resolution;

  // FLUX.2 Pro currently exposes no aspect_ratio parameter in its endpoint
  // capability record. Its required format is still stated in the prompt.
  if (family === "flux") delete config.aspect_ratio;

  return config;
}

export function buildArtworkImagePayload({ model, prompt, mode = "podcast", seed } = {}) {
  const payload = {
    model,
    prompt,
    ...getArtworkImageConfig(model, mode, { seed }),
  };

  if (!envFlagEnabled("ARTWORK_IMAGE_CONFIG_ENABLED", true)) {
    return { model, prompt, n: 1, ...(Number.isInteger(seed) && seed >= 0 ? { seed } : {}) };
  }

  return payload;
}

// Retained for source compatibility with older tests/imports. New production
// traffic uses the dedicated OpenRouter /images endpoint.
export function buildArtworkChatPayload({ model, instruction, mode = "podcast", maxTokens = 1024 } = {}) {
  const configuredModalities = pickFirstEnv("ARTWORK_MODALITIES", "OPENROUTER_ARTWORK_MODALITIES");
  const modalities = configuredModalities
    ? configuredModalities.split(",").map((value) => value.trim()).filter(Boolean)
    : mode === "podcast"
      ? ["image"]
      : ["image", "text"];

  const payload = {
    model,
    messages: [{ role: "user", content: instruction }],
    modalities,
    stream: false,
    max_tokens: Number(maxTokens) > 0 ? Number(maxTokens) : 1024,
  };

  if (envFlagEnabled("ARTWORK_IMAGE_CONFIG_ENABLED", false)) {
    payload.image_config = getArtworkImageConfig(model, mode);
  }

  return payload;
}

export function extractBase64Image(result) {
  const dedicated = result?.data?.find?.((item) => typeof item?.b64_json === "string")?.b64_json;
  if (dedicated) return dedicated;

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
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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
    "premature close", "socket hang up", "econnreset", "etimedout", "fetch failed",
    "network", "request timed out", "request aborted", "body timeout", "terminated",
  ].some((needle) => message.includes(needle));
}

export function artworkRetryDelayMs(attempt) {
  const base = Number(process.env.ARTWORK_RETRY_DELAY_MS || 750) || 750;
  return Math.min(base * Math.max(Number(attempt) || 1, 1), 5_000);
}

export function getArtworkProviderAttempts() {
  const raw = Number(process.env.ARTWORK_PROVIDER_ATTEMPTS || process.env.ARTWORK_PROVIDER_RETRIES || 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.min(Math.max(Math.floor(raw), 1), 6);
}

export function getArtworkRequestTimeoutMs(fallbackTimeoutMs) {
  const raw = Number(process.env.ARTWORK_REQUEST_TIMEOUT_MS || process.env.ARTWORK_PROVIDER_TIMEOUT_MS || fallbackTimeoutMs);
  if (!Number.isFinite(raw) || raw <= 0) return fallbackTimeoutMs;
  return raw;
}
