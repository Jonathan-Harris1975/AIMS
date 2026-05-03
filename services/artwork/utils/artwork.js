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

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";

function getArtworkProviders() {
  return [
    {
      id: "primary",
      keyEnv: "OPENROUTER_API_KEY_ART",
      modelEnv: "OPENROUTER_ART",
      key: process.env.OPENROUTER_API_KEY_ART || "",
      model:
        process.env.OPENROUTER_ART ||
        "google/gemini-2.5-flash-image-preview:exp",
    },
    {
      id: "backup",
      keyEnv: "OPENROUTER_API_KEY_ART_BACKUP",
      modelEnv: "OPENROUTER_ART_BACKUP",
      key: process.env.OPENROUTER_API_KEY_ART_BACKUP || "",
      model: process.env.OPENROUTER_ART_BACKUP || "openai/gpt-5-image-mini",
    },
  ].filter((provider) => provider.key && provider.model);
}

const providers = getArtworkProviders();

if (providers.length === 0) {
  warn("⚠️ Artwork generator missing OpenRouter artwork environment variables", {
    requiredAnyOf: [
      ["OPENROUTER_API_KEY_ART", "OPENROUTER_ART"],
      ["OPENROUTER_API_KEY_ART_BACKUP", "OPENROUTER_ART_BACKUP"],
    ],
  });
}

function buildInstruction(prompt, mode = "podcast") {
  if (mode === "blog") {
    return [
      "Create a wide editorial blog hero image.",
      "Composition: cinematic landscape banner, clearly usable as a website article header.",
      "Style: premium, modern, restrained, atmospheric, no text.",
      `Theme: "${prompt}".`,
    ].join(" ");
  }

  return [
    "Create a 1400x1400 premium editorial podcast cover art image for an adult AI news show.",
    "Mood: sharp, sceptical, intelligent, cinematic, grounded, modern, minimal.",
    "Palette: deep navy, charcoal, restrained neon teal, muted purple, soft metallic highlights.",
    "Style: abstract technological realism, subtle data motifs, clean negative space, premium magazine illustration, no text.",
    `Theme: "${prompt}".`,
    "Avoid pastel fantasy, dreamy clouds, magical orb imagery, childlike sci-fi, cartoon softness, playful candy colours, whimsical storybook visuals, cute illustration, or anything toy-like.",
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

async function callArtworkProvider(provider, prompt, mode) {
  const client = new OpenAI({
    apiKey: provider.key,
    baseURL: OPENROUTER_BASE_URL,
  });

  const result = await client.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildInstruction(prompt, mode),
          },
        ],
      },
    ],
    max_tokens: 2048,
  });

  const image = extractBase64Image(result);
  if (!image) {
    throw new Error("No image data found in OpenRouter response.");
  }

  return image;
}

async function generateArtworkBase64(prompt, { mode = "podcast" } = {}) {
  if (providers.length === 0) {
    throw new Error("Artwork generation disabled: missing OpenRouter artwork env vars.");
  }

  let lastError;

  for (const provider of providers) {
    try {
      const image = await callArtworkProvider(provider, prompt, mode);
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

export async function generatePodcastArtwork(prompt) {
  return generateArtworkBase64(prompt, { mode: "podcast" });
}

export async function generateBlogArtwork(prompt) {
  return generateArtworkBase64(prompt, { mode: "blog" });
}
