import { getObjectAsText, putJson } from "#shared/r2-client.js";
import { info } from "#logger.js";

const DEFAULT_KEY = "outreach/progress.json";

function baseProgress() {
  return {
    lastProcessedIndex: 0,
    batchSize: Number(process.env.OUTREACH_BATCH_SIZE || 40),
    updatedAt: null
  };
}

export async function loadProgress() {
  const key = process.env.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

  try {
    const txt = await getObjectAsText("metasystem", key);
    return { ...baseProgress(), ...JSON.parse(txt) };
  } catch {
    info("outreach.progress.init", { bucket: "metasystem", key });
    return baseProgress();
  }
}

export async function saveProgress(progress) {
  const key = process.env.OUTREACH_PROGRESS_KEY || DEFAULT_KEY;

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
