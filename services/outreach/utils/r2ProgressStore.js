// services/outreach/utils/r2ProgressStore.js

import { getObjectAsText, putJson } from "#shared/r2-client.js";
import { info, error } from "#logger.js";

const DEFAULT_KEY = "outreach/progress.json";

/**
 * Base orchestration state
 */
function baseProgress() {
  return {
    lastProcessedIndex: 0,
    batchSize: Number(process.env.OUTREACH_BATCH_SIZE || 50),
    status: "idle",
    updatedAt: null,
  };
}

/**
 * Load progress from R2 metasystem bucket
 */
export async function loadProgress() {
  const key = process.env.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  try {
    const txt = await getObjectAsText("metasystem", key);
    const parsed = JSON.parse(txt);

    return {
      ...baseProgress(),
      ...parsed,
    };
  } catch (err) {
    // First run or missing file is expected
    info("outreach.progress.init", {
      bucket: "metasystem",
      key,
    });

    return baseProgress();
  }
}

/**
 * Save progress to R2 metasystem bucket
 */
export async function saveProgress(progress) {
  const key = process.env.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  const payload = {
    ...baseProgress(),
    ...progress,
    updatedAt: new Date().toISOString(),
  };

  try {
    await putJson("metasystem", key, payload);

    info("outreach.progress.saved", {
      bucket: "metasystem",
      key,
      lastProcessedIndex: payload.lastProcessedIndex,
    });

    return payload;
  } catch (err) {
    error("outreach.progress.save.failed", {
      bucket: "metasystem",
      key,
      error: err.message,
    });
    throw err;
  }
}
