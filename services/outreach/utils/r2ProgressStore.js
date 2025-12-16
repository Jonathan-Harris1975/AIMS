import { getObjectAsText, putJson } from "#shared/r2-client.js";
import { info } from "#logger.js";

const KEY = process.env.OUTREACH_PROGRESS_KEY || "outreach/progress.json";

const base = () => ({
  batchSize: 50,
  lastProcessedIndex: 0,
  status: "idle",
  lastRunAt: null
});

export async function loadProgress() {
  try {
    const txt = await getObjectAsText("meta", KEY);
    return { ...base(), ...JSON.parse(txt) };
  } catch {
    info("outreach.progress.init");
    return base();
  }
}

export async function saveProgress(progress) {
  const payload = {
    ...base(),
    ...progress,
    lastRunAt: new Date().toISOString()
  };
  await putJson("meta", KEY, payload);
  return payload;
}
