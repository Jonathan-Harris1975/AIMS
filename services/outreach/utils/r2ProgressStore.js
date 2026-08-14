// services/outreach/utils/r2ProgressStore.js

import { getObjectAsText, putPrivateJson } from "../../shared/utils/r2-client.js";
import { info } from "../../../logger.js";

const DEFAULT_KEY = "outreach/progress.json";
const DEFAULT_BATCH_SIZE = Number(process.env.OUTREACH_BATCH_SIZE) || 0;

function baseProgress() {
  return {
    lastProcessedIndex: 0,
    batchSize: DEFAULT_BATCH_SIZE,
    updatedAt: null,
  };
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

export async function loadProgress() {
  const key = process.env.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  try {
    const txt = await getObjectAsText("metasystem", key);
    return { ...baseProgress(), ...JSON.parse(txt) };
  } catch (err) {
    if (!isMissingObjectError(err)) {
      throw err;
    }

    info("outreach.progress.init", { bucket: "metasystem", key });
    return baseProgress();
  }
}

export async function saveProgress(progress) {
  const key = process.env.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  const payload = {
    ...baseProgress(),
    ...progress,
    updatedAt: new Date().toISOString(),
  };

  await putPrivateJson("metasystem", key, payload);

  info("outreach.batch.cursor", {
    nextStartIndex: payload.lastProcessedIndex,
    batchSize: payload.batchSize,
  });

  return payload;
}
