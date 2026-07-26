// ============================================================
// 🖼️ Artwork Generator (OpenRouter Image Model)
// ============================================================
//
// Shared image transport for podcast covers and blog hero artwork.
// Uses OpenRouter chat/completions image-output models. The request
// must explicitly ask for image output with modalities, otherwise some
// providers can close the response before returning usable image data.
// ============================================================

import { warn, error, info } from "../../../logger.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { getArtworkProviders } from "./openrouterProviders.js";
import { applyArtworkPromptPolicy } from "./artworkPromptPolicy.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import {
  artworkRetryDelayMs,
  buildArtworkChatPayload,
  extractBase64Image,
  getArtworkProviderAttempts,
  getArtworkRequestTimeoutMs,
  isTransientArtworkError,
  makeArtworkHttpError,
  safeSnippet,
} from "./openrouterImagePayload.js";

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";

const ARTWORK_TIMEOUT_MS = Number(process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT) || 120_000;
const ARTWORK_REQUEST_TIMEOUT_MS = getArtworkRequestTimeoutMs(ARTWORK_TIMEOUT_MS);
const ARTWORK_MAX_TOKENS = Number(process.env.ARTWORK_MAX_TOKENS || 4096);

const providers = getArtworkProviders();

if (providers.length === 0) {
  warn("⚠️ Artwork generator missing OpenRouter artwork environment variables", {
    requiredAnyOf: [
      ["OPENROUTER_API_KEY", "AI_MODEL_IMAGE"],
      ["OPENROUTER_API_KEY", "OPENROUTER_ART"],
      ["OPENROUTER_API_KEY", "OPENROUTER_ART_BACKUP"],
      ["OPENROUTER_API_KEY_ART", "OPENROUTER_ART"],
      ["OPENROUTER_API_KEY_ART_BACKUP", "OPENROUTER_ART_BACKUP"],
    ],
  });
}

export function buildInstruction(prompt, mode = "podcast", date) {
  const policyPrompt = applyArtworkPromptPolicy(prompt, { date, mode });

  if (mode === "blog") {
    return [
      "Create a wide editorial blog hero image.",
      "Composition: cinematic landscape banner, clearly usable as a website article header.",
      "Style: premium, modern, restrained, atmospheric and editorial rather than promotional.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
    ].join(" ");
  }


  if (mode === "social") {
    return [
      "Create a premium square editorial social-media image.",
      "Composition: strong single focal subject, instantly readable at thumbnail size, cinematic depth, high contrast, modern magazine-quality framing.",
      "Style: intelligent, contemporary, human, engaging and editorial rather than corporate or stock-photo-like.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
    ].join(" ");
  }

  return [
    "Create a 1400x1400 premium editorial podcast cover art image for an adult AI news show.",
    "Mood: sharp, sceptical, intelligent, cinematic, grounded, modern and minimal.",
    "Style: abstract technological realism, subtle data motifs, clean negative space and premium magazine illustration.",
    `Creative direction: ${policyPrompt}`,
    "Avoid pastel fantasy, dreamy clouds, magical orb imagery, childlike sci-fi, cartoon softness, playful candy colours, whimsical storybook visuals, cute illustration or anything toy-like.",
    "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
  ].join(" ");
}

// Shortened fallback prompt used only after every normal attempt across
// every provider has failed. Some providers reject or silently drop overly
// long prompts; this keeps only the essential creative direction and text-
// free compliance instruction, on the theory that prompt length/complexity
// may itself be a contributing failure cause. OB-004 / BSC-OB-005.
export function buildShortInstruction(prompt, mode = "podcast", date) {
  const policyPrompt = applyArtworkPromptPolicy(prompt, { date, mode });
  const trimmedDirection = String(policyPrompt || "").split(/\s+/).slice(0, 24).join(" ");

  if (mode === "blog") {
    return `Editorial blog hero image, cinematic landscape banner, premium and restrained. ${trimmedDirection} No text, letters, numbers, logos or watermarks.`;
  }


  if (mode === "social") {
    return `Premium square editorial social image, one strong recognisable focal subject, cinematic, high contrast and engaging. ${trimmedDirection} No text, letters, numbers, logos or watermarks.`;
  }

  return `Premium editorial podcast cover art, abstract technological realism, minimal. ${trimmedDirection} No text, letters, numbers, logos or watermarks.`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestArtworkFromProvider(provider, prompt, mode, date, { useShortInstruction = false } = {}) {
  const instruction = useShortInstruction ? buildShortInstruction(prompt, mode, date) : buildInstruction(prompt, mode, date);
  const payload = buildArtworkChatPayload({
    model: provider.model,
    instruction,
    maxTokens: ARTWORK_MAX_TOKENS,
    mode,
  });

  const headers = {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "https://jonathan-harris.online",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
  };

  const attempts = getArtworkProviderAttempts();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(`${OPENROUTER_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: ARTWORK_REQUEST_TIMEOUT_MS,
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw makeArtworkHttpError(res.status, msg, provider);
      }

      const json = await res.json();
      const image = extractBase64Image(json);
      if (!image) {
        const err = new Error(`No image data found in OpenRouter response from ${provider.modelEnv}.`);
        err.responseSnippet = safeSnippet(JSON.stringify(json || {}), 500);
        throw err;
      }

      return image;
    } catch (err) {
      lastError = err;

      if (attempt >= attempts || !isTransientArtworkError(err)) {
        throw err;
      }

      warn("Artwork provider transient failure; retrying", {
        provider: provider.id,
        modelEnv: provider.modelEnv,
        model: provider.model,
        attempt,
        attempts,
        error: err?.message || String(err),
        mode,
      });

      await sleep(artworkRetryDelayMs(attempt));
    }
  }

  throw lastError || new Error(`No image data returned from ${provider.modelEnv}.`);
}

async function generateArtworkBase64(prompt, { mode = "podcast", date } = {}) {
  if (providers.length === 0) {
    throw new Error("Artwork generation disabled: missing OpenRouter artwork env vars.");
  }

  let lastError;

  for (const provider of providers) {
    try {
      const image = await requestArtworkFromProvider(provider, prompt, mode, date);
      if (provider.id === "backup") {
        info("🎨 Artwork generated with backup OpenRouter image model", {
          modelEnv: provider.modelEnv,
          model: provider.model,
          mode,
        });
      }
      return image;
    } catch (e) {
      lastError = e;
      error("Artwork provider failed", {
        provider: provider.id,
        modelEnv: provider.modelEnv,
        model: provider.model,
        status: e?.status,
        error: e?.message || e,
        mode,
      });
    }
  }

  // Every provider failed with the full-length prompt. As a last resort,
  // sweep the providers again with a much shorter prompt in case prompt
  // length/complexity contributed to the failures. OB-004 / BSC-OB-005.
  if (THRESHOLDS.podcastArtwork.shortPromptRetryEnabled) {
    warn("🎨 All artwork providers failed with full prompt; retrying with shortened prompt", { mode });
    for (const provider of providers) {
      try {
        const image = await requestArtworkFromProvider(provider, prompt, mode, date, { useShortInstruction: true });
        info("🎨 Artwork generated with shortened prompt after full-prompt failures", {
          provider: provider.id,
          modelEnv: provider.modelEnv,
          mode,
        });
        return image;
      } catch (e) {
        lastError = e;
        error("Artwork provider failed on shortened-prompt retry", {
          provider: provider.id,
          modelEnv: provider.modelEnv,
          model: provider.model,
          status: e?.status,
          error: e?.message || e,
          mode,
        });
      }
    }
  }

  throw new Error(`Failed to generate artwork: ${lastError?.message || "all providers failed"}`);
}

export async function generatePodcastArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "podcast" });
}

export async function generateBlogArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "blog" });
}

export async function generateSocialArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "social" });
}
