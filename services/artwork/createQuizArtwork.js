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

export async function createQuizArtwork({
  sessionId,
  prompt,
  date,
  cardType = "question",
  card = null,
  fallbackUrl = "",
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
    error("artwork.quiz.fail", {
      sessionId: safeSession,
      cardType: safeType,
      bucketAlias: "blogImages",
      error: err?.message || String(err),
      fallbackUrl: fallbackUrl || undefined,
    });

    return {
      ok: false,
      error: err?.message || String(err),
      publicUrl: fallbackUrl || "",
      fallback: Boolean(fallbackUrl),
    };
  }
}
