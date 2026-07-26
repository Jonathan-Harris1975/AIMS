// services/artwork/createQuizArtwork.js

import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateQuizArtwork } from "./utils/artwork.js";

const ARTWORK_TIMEOUT_MS =
  Number(process.env.ZERNIO_QUIZ_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT)
  || 180_000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function cleanPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createQuizArtwork({
  sessionId,
  prompt,
  date,
  cardType = "question",
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
    });

    const base64Data = await withTimeout(
      generateQuizArtwork(prompt, { date }),
      ARTWORK_TIMEOUT_MS,
      `Quiz ${safeType} artwork generation`,
    );

    const buffer = Buffer.from(base64Data, "base64");
    const key = `zernio/quiz/${safeSession}-${safeType}.png`;
    const publicUrl = await uploadBuffer("blogImages", key, buffer, "image/png");

    info("artwork.quiz.done", {
      sessionId: safeSession,
      cardType: safeType,
      bucketAlias: "blogImages",
      key,
      publicUrl,
    });

    return { ok: true, key, publicUrl };
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
