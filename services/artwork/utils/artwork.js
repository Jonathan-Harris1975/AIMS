// ============================================================
// 🖼️ Artwork Generator (OpenRouter Image Model)
// ============================================================
//
// Shared image transport for podcast covers and blog hero artwork.
// ============================================================

import OpenAI from "openai";
import { warn, error } from "../../../logger.js";

const REQUIRED = [
  "OPENROUTER_API_KEY_ART_BACKUP",
  "OPENROUTER_ART_BACKUP",
];

const missing = REQUIRED.filter((key) => !process.env[key] || process.env[key].trim() === "");

if (missing.length > 0) {
  warn("⚠️ Artwork generator missing required environment variables", { missing });
}

const cfg = {
  key: process.env.OPENROUTER_API_KEY_ART_BACKUP || "",
  baseURL: "https://openrouter.ai/api/v1",
  model: process.env.OPENROUTER_ART_BACKUP || "openai/gpt-5-image-mini",
};

const client = new OpenAI({
  apiKey: cfg.key,
  baseURL: cfg.baseURL,
});

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

async function generateArtworkBase64(prompt, { mode = "podcast" } = {}) {
  if (!cfg.key || !cfg.model) {
    throw new Error("Artwork generation disabled: missing required OpenRouter env vars.");
  }

  try {
    const result = await client.chat.completions.create({
      model: cfg.model,
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

    throw new Error("No image data found in OpenRouter response.");
  } catch (e) {
    error("Artwork generation error", { error: e?.message || e, mode });
    throw new Error(`Failed to generate artwork: ${e.message}`);
  }
}

export async function generatePodcastArtwork(prompt) {
  return generateArtworkBase64(prompt, { mode: "podcast" });
}

export async function generateBlogArtwork(prompt) {
  return generateArtworkBase64(prompt, { mode: "blog" });
}
