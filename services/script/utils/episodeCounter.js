// ============================================================
// 🔢 Persistent Episode Counter (R2-backed)
// ============================================================
// Uses the *metasystem* bucket exclusively for episode counter
// ============================================================

import { log } from "../../../logger.js";
import { getObjectAsText, putPrivateJson } from "../../shared/utils/r2-client.js";

// Correct bucket alias for episode counter
const EPISODE_COUNTER_BUCKET = "metasystem";

// Clean, root-level key
const EPISODE_COUNTER_KEY = "episode-counter.json";

function isProductionEpisodeMode() {
  return process.env.PODCAST_RSS_EP === "Yes";
}

function isMissingObjectError(err) {
  const text = `${err?.name || ""} ${err?.code || ""} ${err?.message || ""}`.toLowerCase();
  return (
    text.includes("nosuchkey") ||
    text.includes("not found") ||
    text.includes("notfound") ||
    text.includes("the specified key does not exist")
  );
}

// Load counter
async function loadCounter() {
  try {
    const raw = await getObjectAsText(EPISODE_COUNTER_BUCKET, EPISODE_COUNTER_KEY);
    const parsed = JSON.parse(raw);

    if (typeof parsed.nextEpisodeNumber === "number" && parsed.nextEpisodeNumber > 0) {
      return parsed;
    }

    throw new Error("episodeCounter: stored counter is invalid");
  } catch (err) {
    if (!isMissingObjectError(err)) {
      throw err;
    }

    log.warn("episodeCounter: counter missing, initialising new one");
    return { nextEpisodeNumber: 1 };
  }
}

// Save counter
async function saveCounter(counter) {
  await putPrivateJson(EPISODE_COUNTER_BUCKET, EPISODE_COUNTER_KEY, counter);
}

// Issue next episode number
export async function getNextEpisodeNumber() {
  if (!isProductionEpisodeMode()) {
    log.info("episodeCounter: test mode active, not touching persistent counter", {
      PODCAST_RSS_EP: process.env.PODCAST_RSS_EP,
    });
    return null;
  }

  const counter = await loadCounter();
  const episodeNumber = counter.nextEpisodeNumber;

  counter.nextEpisodeNumber = episodeNumber + 1;
  await saveCounter(counter);

  log.info("episodeCounter: issued new episode number", { episodeNumber });
  return episodeNumber;
}

// Attach to meta
export async function attachEpisodeNumberIfNeeded(meta) {
  if (!meta || typeof meta !== "object") return meta;

  const episodeNumber = await getNextEpisodeNumber();
  if (episodeNumber != null) {
    meta.episodeNumber = episodeNumber;
  }

  return meta;
}

export default {
  getNextEpisodeNumber,
  attachEpisodeNumberIfNeeded,
};
