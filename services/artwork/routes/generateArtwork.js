// ============================================================
// 🎨 Artwork Generator — Express Route + Function Export
// ============================================================

import express from "express";
import { putObject } from "../../shared/utils/r2-client.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  artworkGenerateBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { info, error } from "../../../logger.js";
import { getArtworkProviders } from "../utils/openrouterProviders.js";

const router = express.Router();
const ARTWORK_TIMEOUT_MS = Number(process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT) || 120_000;

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1";


function extractImageBase64(json) {
  const direct = json?.choices?.[0]?.message?.content?.[0]?.image_data;
  if (direct) return direct;

  const images = json?.choices?.[0]?.message?.images;
  if (Array.isArray(images) && images[0]?.image_url?.url) {
    const url = images[0].image_url.url;
    if (url.startsWith("data:image/png;base64,")) return url.split(",")[1];
  }

  const content = json?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const imageItem = content.find((item) => item.type === "image" && item.image_url?.url);
    const url = imageItem?.image_url?.url;
    if (url?.startsWith("data:image/png;base64,")) return url.split(",")[1];
  }

  const raw = JSON.stringify(json);
  const match = raw.match(/data:image\/png;base64,([^"]+)/);
  return match?.[1] || null;
}

async function requestArtworkFromProvider(provider, prompt, safeTitle) {
  const headers = {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "https://jonathan-harris.online",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || safeTitle,
  };

  const body = JSON.stringify({
    model: provider.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  const res = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body,
    timeout: ARTWORK_TIMEOUT_MS,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Artwork generation failed with ${provider.modelEnv}: ${msg.slice(0, 200) || res.status}`);
  }

  const json = await res.json();
  const imageData = extractImageBase64(json);
  if (!imageData) throw new Error(`No image data returned from ${provider.modelEnv}.`);

  return imageData;
}

function sendRouteError(req, res, err, fallbackMessage = "Internal error") {
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;
  return res.status(500).json({ ok: false, error: fallbackMessage, requestId });
}

// ------------------------------------------------------------
// Generate Artwork Function
// ------------------------------------------------------------
export async function generateArtwork(sessionId, prompt = "") {
  if (!prompt || !prompt.trim()) {
    prompt = `Podcast cover art for ${sessionId} — abstract AI-themed design, high-contrast, bold typography`;
  }

  const safeTitle = encodeURIComponent(
    process.env.APP_TITLE || "Turing's Torch: AI Weekly Artwork"
  );

  const providers = getArtworkProviders();
  if (providers.length === 0) {
    throw new Error(
      "Artwork generation disabled: missing OpenRouter artwork env vars."
    );
  }

  let lastError;
  let imageData;
  let usedProvider;

  for (const provider of providers) {
    try {
      imageData = await requestArtworkFromProvider(provider, prompt, safeTitle);
      usedProvider = provider;
      break;
    } catch (err) {
      lastError = err;
      error("💥 Artwork provider failed", {
        sessionId,
        provider: provider.id,
        modelEnv: provider.modelEnv,
        model: provider.model,
        error: err?.message || String(err),
      });
    }
  }

  if (!imageData) {
    throw lastError || new Error("No image data returned from OpenRouter.");
  }

  const buffer = Buffer.from(imageData, "base64");
  const key = `${sessionId}.png`;

  await putObject("art", key, buffer, "image/png");

  const publicUrl = `${process.env.R2_PUBLIC_BASE_URL_ART}/${encodeURIComponent(key)}`;
  info("🎨 Artwork saved to R2", {
    sessionId,
    key,
    publicUrl,
    provider: usedProvider?.id,
    modelEnv: usedProvider?.modelEnv,
  });

  return publicUrl;
}

// ------------------------------------------------------------
// Express Route Wrapper
// ------------------------------------------------------------
router.post("/", hookdeckDedupe("artwork:generate"), async (req, res) => {
  let sessionId;

  try {
    const parsed = validateBody(artworkGenerateBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    sessionId = sanitizeSessionId(parsed.data.sessionId || `art-${Date.now()}`, "art");
    const prompt = parsed.data.prompt || "Podcast cover art: abstract AI design";
    const url = await generateArtwork(sessionId, prompt);
    res.json({ ok: true, sessionId, url });
  } catch (err) {
    error("💥 Artwork route failed", {
      sessionId,
      requestId: req?.id || req?.headers?.["x-request-id"] || null,
      error: err?.stack || err?.message || String(err),
    });
    return sendRouteError(req, res, err, "Artwork generation failed");
  }
});

export default router;
