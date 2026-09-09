// services/artwork/createQuizArtwork.js

import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateQuizArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";
import { renderQuizCardPng } from "./utils/quizCardRenderer.js";

const ARTWORK_TIMEOUT_MS =
  Number(process.env.ZERNIO_QUIZ_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT)
  || 180_000;

function cleanPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deterministicQuizArtworkEnabled() {
  const raw = String(process.env.ZERNIO_QUIZ_DETERMINISTIC_ARTWORK ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function validFallbackUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function createQuizArtwork({
  sessionId,
  prompt,
  date,
  cardType = "question",
  card = null,
  fallbackUrl = "",
  allowFallback = false,
} = {}) {
  const safeSession = cleanPart(sessionId || `quiz-${Date.now()}`);
  const safeType = cleanPart(cardType || "question").toLowerCase();

  try {
    debug("artwork.quiz.start", {
      sessionId: safeSession,
      cardType: safeType,
      bucketAlias: "blogImages",
      prefix: "zernio/quiz",
      deterministic: deterministicQuizArtworkEnabled() && Boolean(card),
    });

    let image;
    let source = "generated";

    if (deterministicQuizArtworkEnabled() && card) {
      try {
        const buffer = await runArtworkTask(
          (signal) => renderQuizCardPng({ ...card, type: safeType }, { signal }),
          Math.min(ARTWORK_TIMEOUT_MS, 60_000),
          `Quiz ${safeType} deterministic rendering`,
        );
        image = { buffer, mimeType: "image/png", extension: "png" };
        source = "deterministic-renderer";
      } catch (rendererError) {
        warn("artwork.quiz.renderer_fallback", {
          sessionId: safeSession,
          cardType: safeType,
          error: rendererError?.message || String(rendererError),
        });
      }
    }

    if (!image) {
      const base64Data = await runArtworkTask(
        (signal) => generateQuizArtwork(prompt, { date, signal }),
        ARTWORK_TIMEOUT_MS,
        `Quiz ${safeType} artwork generation`,
      );
      image = detectImageFormat(base64Data);
    }

    const key = source === "deterministic-renderer"
      ? `zernio/quiz/${safeSession}-${safeType}.png`
      : `zernio/quiz/${safeSession}-${safeType}.${image.extension}`;
    const publicUrl = await uploadBuffer("blogImages", key, image.buffer, image.mimeType);

    info("artwork.quiz.done", {
      sessionId: safeSession,
      cardType: safeType,
      bucketAlias: "blogImages",
      key,
      publicUrl,
      source,
    });

    return { ok: true, key, publicUrl, source };
  } catch (err) {
    const curatedFallback = allowFallback ? validFallbackUrl(fallbackUrl) : "";
    error("artwork.quiz.fail", {
      sessionId: safeSession,
      cardType: safeType,
      bucketAlias: "blogImages",
      error: err?.message || String(err),
      fallbackUrl: curatedFallback || undefined,
    });

    if (curatedFallback) {
      warn("artwork.quiz.curated_fallback", {
        sessionId: safeSession,
        cardType: safeType,
        fallbackUrl: curatedFallback,
        originalError: err?.message || String(err),
      });
      return {
        ok: true,
        error: undefined,
        originalError: err?.message || String(err),
        warning: `Fresh quiz ${safeType} artwork was unavailable; the stored ${safeType} image was used.`,
        publicUrl: curatedFallback,
        fallback: true,
        imageStatus: "curated-static-fallback",
      };
    }

    return {
      ok: false,
      error: err?.message || String(err),
      publicUrl: "",
      fallback: false,
      imageStatus: "generation-failed",
    };
  }
}
