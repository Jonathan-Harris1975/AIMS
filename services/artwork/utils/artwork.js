// ============================================================
// 🖼️ Artwork Generator (OpenRouter Image Model)
// ============================================================
//
// Shared model-aware image transport for every AIMS artwork lane.
// Uses OpenRouter's dedicated /images endpoint and applies provider-specific
// prompt structure plus pixel-level relevance/quality gates.
// ============================================================

import { warn, error, info } from "../../../logger.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { getArtworkProviders } from "./openrouterProviders.js";
import { applyArtworkPromptPolicy } from "./artworkPromptPolicy.js";
import { buildModelAwareArtworkPrompt } from "./artworkModelPrompt.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { auditArtworkBase64 } from "./artworkVisualQa.js";
import {
  artworkRetryDelayMs,
  buildArtworkImagePayload,
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

  if (mode === "newsletter") {
    return [
      "Create a wide premium editorial news image for the AI Edge newsletter.",
      "Composition: one concrete AI-news scene with a decisive focal subject and cinematic depth. This is an illustration, not a banner design or magazine-cover mock-up.",
      "Style: intelligent, current, grounded, high-contrast editorial realism. No travel, landscape, lifestyle or inspirational-journey imagery.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: remove all text, pseudo-text, title panels, buttons, interface labels, logos and watermarks before returning the image.",
    ].join(" ");
  }

  if (mode === "social-blog") {
    return [
      "Create a premium wide editorial image for a social-distributed AI blog post.",
      "Composition: one source-specific real-world consequence, decision or technical action with a strong phone-feed focal subject. It must visually match the selected source story, not generic AI news.",
      "Style: cinematic editorial realism, high contrast, bold controlled colour and immediate visual tension. No infographic, dashboard, diagram, travel scene, generic office or decorative data-centre glamour.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: no visible text, pseudo-text, callout boxes, labels, logos, interface chrome or watermarks.",
    ].join(" ");
  }

  if (mode === "blog") {
    return [
      "Create a wide editorial blog hero image.",
      "Composition: cinematic landscape banner, clearly usable as a website article header.",
      "Style: premium, modern, restrained, atmospheric and editorial rather than promotional.",
      `Creative direction: ${policyPrompt}`,
      "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
    ].join(" ");
  }


  if (mode === "quiz") {
    return [
      "Create a premium square AI quiz card for social media.",
      "The supplied wording is the design content and must remain exact.",
      "Optimise for phone viewing: bold hierarchy, readable type, strong separation between answer choices and uncluttered composition.",
      `Creative direction: ${policyPrompt}`,
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
    "Create square premium editorial podcast episode artwork for an adult AI news show.",
    "Composition: one dominant episode-specific real-world story occupying roughly seventy per cent of the frame, with at most one supporting element. The subject must be recognisable from the episode rather than a generic AI symbol.",
    "Mood: sharp, sceptical, intelligent, cinematic, grounded and modern.",
    "Style: premium magazine-feature realism with strong hierarchy, believable physical detail and clean negative space.",
    `Creative direction: ${policyPrompt}`,
    "Final compliance check: remove all accidental text, pseudo-text, logos, UI, generic glowing brains, symmetric emblems and unrelated decorative technology motifs.",
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

  if (mode === "newsletter") {
    return `AI-news editorial illustration, one concrete technical or human-scale focal scene, no banner layout, no travel or scenery. ${trimmedDirection} No text, pseudo-text, letters, numbers, logos, panels or watermarks.`;
  }

  if (mode === "social-blog") {
    return `Source-specific AI social-blog editorial image, wide composition, one concrete consequence or technical action, cinematic and high contrast. ${trimmedDirection} No infographic, travel, generic office, text, pseudo-text, labels, logos or watermarks.`;
  }

  if (mode === "blog") {
    return `Editorial blog hero image, cinematic landscape banner, premium and restrained. ${trimmedDirection} No text, letters, numbers, logos or watermarks.`;
  }


  if (mode === "quiz") {
    return `Square social AI quiz card. Keep every supplied answer label and visible phrase exact. Large readable typography, four clear answer panels, high contrast, polished editorial design. ${trimmedDirection}`;
  }


  if (mode === "social") {
    return `Premium square editorial social image, one strong recognisable focal subject, cinematic, high contrast and engaging. ${trimmedDirection} No text, letters, numbers, logos or watermarks.`;
  }

  return `Square premium podcast episode artwork, one dominant source-specific real-world subject, strong editorial hierarchy and cinematic realism. ${trimmedDirection} No text, generic AI emblems, unrelated technology decoration, logos or watermarks.`;
}

async function sleep(ms, signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "y"].includes(String(value).trim().toLowerCase());
}

function visualQaModes() {
  return new Set(String(process.env.ARTWORK_VISUAL_QA_MODES || "podcast,blog,newsletter,social,social-blog,quiz")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
}

function shouldAuditArtwork(mode) {
  return parseBoolean(process.env.ARTWORK_VISUAL_QA_ENABLED, true) && visualQaModes().has(String(mode || "").toLowerCase());
}

function buildQaRepairPrompt(prompt, qa = {}) {
  const defects = [...(qa.hardDefects || []), ...(qa.defects || [])].filter(Boolean).slice(0, 8);
  return [
    prompt,
    "REGENERATION REQUIRED AFTER PIXEL-LEVEL QA.",
    `Previous defects: ${defects.join(" | ") || qa.summary || "image failed visual QA"}.`,
    "Create a materially different composition that fixes every listed defect. Do not preserve the failed layout.",
  ].join(" ");
}

async function requestArtworkFromProvider(provider, prompt, mode, date, { useShortInstruction = false, signal } = {}) {
  const baseInstruction = useShortInstruction ? buildShortInstruction(prompt, mode, date) : buildInstruction(prompt, mode, date);
  const instruction = buildModelAwareArtworkPrompt({
    model: provider.model,
    mode,
    creativeDirection: baseInstruction,
  });
  const payload = buildArtworkImagePayload({
    model: provider.model,
    prompt: instruction,
    mode,
  });

  const headers = {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "https://jonathan-harris.online",
    "X-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
  };

  const attempts = getArtworkProviderAttempts();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
    try {
      const res = await fetchWithTimeout(`${OPENROUTER_BASE_URL.replace(/\/+$/, "")}/images`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: ARTWORK_REQUEST_TIMEOUT_MS,
        signal,
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw makeArtworkHttpError(res.status, msg, provider);
      }

      const json = await res.json();
      let image = extractBase64Image(json);
      if (!image) {
        const err = new Error(`No image data found in OpenRouter response from ${provider.modelEnv}.`);
        err.responseSnippet = safeSnippet(JSON.stringify(json || {}), 500);
        throw err;
      }

      if (shouldAuditArtwork(mode)) {
        const qaRequired = parseBoolean(process.env.ARTWORK_VISUAL_QA_REQUIRED, true);
        const maxRegenerations = Math.max(0, Math.min(2, Number(process.env.ARTWORK_VISUAL_QA_MAX_REGENERATIONS || 1)));
        let qa;
        let qaPrompt = prompt;
        for (let qaAttempt = 0; qaAttempt <= maxRegenerations; qaAttempt += 1) {
          try {
            qa = await auditArtworkBase64({
              base64: image,
              mode,
              creativePrompt: qaPrompt,
              sessionId: `artwork-${mode}-${Date.now()}-${qaAttempt}`,
              signal,
            });
          } catch (qaError) {
            if (!qaRequired) {
              warn("artwork.visual_qa.unavailable", { mode, provider: provider.id, error: qaError?.message || String(qaError) });
              return image;
            }
            throw qaError;
          }

          info("artwork.visual_qa.result", {
            mode,
            provider: provider.id,
            score: qa.score,
            pass: qa.pass,
            relevance: qa.relevance,
            textSafety: qa.textSafety,
            hardDefects: qa.hardDefects,
          });
          if (qa.pass) return image;
          if (qaAttempt >= maxRegenerations) {
            const err = new Error(`Generated ${mode} artwork failed visual QA (${qa.score}/${qa.threshold}): ${[...(qa.hardDefects || []), ...(qa.defects || [])].join(" | ") || qa.summary}`);
            err.statusCode = 422;
            err.artworkVisualQa = qa;
            throw err;
          }

          qaPrompt = buildQaRepairPrompt(prompt, qa);
          const retryInstruction = buildModelAwareArtworkPrompt({
            model: provider.model,
            mode,
            creativeDirection: buildInstruction(qaPrompt, mode, date),
          });
          const retryPayload = buildArtworkImagePayload({
            model: provider.model,
            prompt: retryInstruction,
            mode,
          });
          const retryResponse = await fetchWithTimeout(`${OPENROUTER_BASE_URL.replace(/\/+$/, "")}/images`, {
            method: "POST",
            headers,
            body: JSON.stringify(retryPayload),
            timeout: ARTWORK_REQUEST_TIMEOUT_MS,
            signal,
          });
          if (!retryResponse.ok) {
            const msg = await retryResponse.text().catch(() => "");
            throw makeArtworkHttpError(retryResponse.status, msg, provider);
          }
          const retryJson = await retryResponse.json();
          image = extractBase64Image(retryJson);
          if (!image) throw new Error(`No image data found in QA regeneration response from ${provider.modelEnv}.`);
        }
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

      await sleep(artworkRetryDelayMs(attempt), signal);
    }
  }

  throw lastError || new Error(`No image data returned from ${provider.modelEnv}.`);
}

async function generateArtworkBase64(prompt, { mode = "podcast", date, signal } = {}) {
  if (providers.length === 0) {
    throw new Error("Artwork generation disabled: missing OpenRouter artwork env vars.");
  }

  let lastError;

  for (const provider of providers) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
    try {
      const image = await requestArtworkFromProvider(provider, prompt, mode, date, { signal });
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
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork generation aborted");
      try {
        const image = await requestArtworkFromProvider(provider, prompt, mode, date, { useShortInstruction: true, signal });
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

export async function generateNewsletterArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "newsletter" });
}

export async function generateSocialBlogArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "social-blog" });
}

export async function generateSocialArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "social" });
}

export async function generateQuizArtwork(prompt, options = {}) {
  return generateArtworkBase64(prompt, { ...options, mode: "quiz" });
}
