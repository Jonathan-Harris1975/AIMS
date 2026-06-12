// ============================================================
// 🖼️ Artwork Generator (OpenRouter Image Model)
// ============================================================
//
// Shared image transport for podcast covers and blog hero artwork.
// Primary artwork keeps the existing Nano Banana / Gemini image setup.
// Backup artwork uses the spreadsheet-provided ChatGPT image model.
// ============================================================

import OpenAI from "openai";
import { warn, error, info } from "../../../logger.js";
import { getArtworkProviders } from "./openrouterProviders.js";
import { applyArtworkPromptPolicy } from "./artworkPromptPolicy.js";

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";

const ARTWORK_TIMEOUT_MS = Number(process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT) || 120_000;
const ARTWORK_MAX_TOKENS = Number(process.env.ARTWORK_MAX_TOKENS || 2048);


const providers = getArtworkProviders();

if (providers.length === 0) {
  warn("⚠️ Artwork generator missing OpenRouter artwork environment variables", {
    requiredAnyOf: [
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

  return [
    "Create a 1400x1400 premium editorial podcast cover art image for an adult AI news show.",
    "Mood: sharp, sceptical, intelligent, cinematic, grounded, modern and minimal.",
    "Style: abstract technological realism, subtle data motifs, clean negative space and premium magazine illustration.",
    `Creative direction: ${policyPrompt}`,
    "Avoid pastel fantasy, dreamy clouds, magical orb imagery, childlike sci-fi, cartoon softness, playful candy colours, whimsical storybook visuals, cute illustration or anything toy-like.",
    "Final compliance check: inspect the whole composition and remove every accidental letter-like, number-like, logo-like or watermark-like mark before returning the image.",
  ].join(" ");
}

function extractBase64Image(result) {
  const images = result.choices?.[0]?.message?.images;
  if (Array.isArray(images) && images[0]?.image_url?.url) {
    const url = images[0].image_url.url;
    if (url.startsWith("data:image/png;base64,")) {
      return url.split(",")[1];
    }
  }

  const content = result.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const imageItem = content.find((item) => item.type === "image" && item.image_url?.url);
    const url = imageItem?.image_url?.url;
    if (url && url.startsWith("data:image/png;base64,")) {
      return url.split(",")[1];
    }
  }

  const raw = JSON.stringify(result);
  const match = raw.match(/data:image\/png;base64,([^"]+)/);
  if (match) return match[1];

  return null;
}

async function callArtworkProvider(provider, prompt, mode, date) {
  const client = new OpenAI({
    apiKey: provider.key,
    baseURL: OPENROUTER_BASE_URL,
    timeout: ARTWORK_TIMEOUT_MS,
    defaultHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "https://jonathan-harris.online",
      "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
    },
  });

  const result = await client.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildInstruction(prompt, mode, date),
          },
        ],
      },
    ],
    max_tokens: ARTWORK_MAX_TOKENS,
  });

  const image = extractBase64Image(result);
  if (!image) {
    throw new Error("No image data found in OpenRouter response.");
  }

  return image;
}

async function generateArtworkBase64(prompt, { mode = "podcast", date } = {}) {
  if (providers.length === 0) {
    throw new Error("Artwork generation disabled: missing OpenRouter artwork env vars.");
  }

  let lastError;

  for (const provider of providers) {
    try {
      const image = await callArtworkProvider(provider, prompt, mode, date);
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
        error: e?.message || e,
        mode,
      });
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
