// services/outreach/utils/r2ProgressStore.js

import { getObjectAsText, putJson } from "../../shared/utils/r2-client.js";
import { info } from "../../../logger.js";
import { ENV } from "../../../scripts/envBootstrap.js";

const DEFAULT_KEY = "outreach/progress.json";

function baseProgress() {
  return {
    lastProcessedIndex: 0,
    batchSize: ENV.OUTREACH_BATCH_SIZE,
    updatedAt: null
  };
}

export async function loadProgress() {
  const key = ENV.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  try {
    const txt = await getObjectAsText("metasystem", key);
    return { ...baseProgress(), ...JSON.parse(txt) };
  } catch {
    info("outreach.progress.init", { bucket: "metasystem", key });
    return baseProgress();
  }
}

export async function saveProgress(progress) {
  const key = ENV.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  const payload = {
    ...baseProgress(),
    ...progress,
    updatedAt: new Date().toISOString()
  };

  await putJson("metasystem", key, payload);

  info("outreach.batch.cursor", {
    nextStartIndex: payload.lastProcessedIndex,
    batchSize: payload.batchSize
  });

  return payload;
}
