import fs from "fs";
import path from "path";
import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { appendLeadRows } from "./sheetService.js";
import { loadProgress, saveProgress } from "../utils/r2ProgressStore.js";

const KEYWORDS_FILE =
  process.env.OUTREACH_KEYWORDS_FILE ||
  "services/outreach/keywords.txt";

const BATCH_SIZE = Number(process.env.OUTREACH_BATCH_SIZE || 40);
const RATE_DELAY_MS = Number(process.env.SERP_RATE_DELAY_MS || 1500);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadKeywords() {
  return fs
    .readFileSync(path.resolve(KEYWORDS_FILE), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// --------------------------------------------------
// PUBLIC API (used by routes)
// --------------------------------------------------

export async function getProgress() {
  return loadProgress();
}

export async function resetProgress(index = 0) {
  return saveProgress({ lastProcessedIndex: Number(index) || 0 });
}

export async function runNextBatch() {
  const keywords = loadKeywords();
  const progress = await loadProgress();

  const start = progress.lastProcessedIndex;
  const batch = keywords.slice(start, start + BATCH_SIZE);

  console.log(
    `🚀 Outreach batch starting: ${start} → ${start + batch.length}`
  );

  let globalIndex = start;
  let totalLeads = 0;

  for (let i = 0; i < batch.length; i++) {
    const keyword = batch[i];

    console.log(`🔁 Keyword ${i + 1}/${batch.length}: ${keyword}`);

    const result = await serpOutreach(keyword);
    const good = extractGoodLeads(result, keyword);

    if (good.length) {
      const rows = good.map((r) => [
        r.timestamp,
        r.keyword,
        r.domain,
        r.da,
        r.serpPosition ?? null,
        r.email,
        r.emailScore,
        r.leadScore,
      ]);

      await appendLeadRows(rows);
      totalLeads += good.length;
    }

    globalIndex++;

    console.log(
      `📊 Progress: keyword ${globalIndex}/${keywords.length}`
    );

    await wait(RATE_DELAY_MS);
  }

  await saveProgress({ lastProcessedIndex: globalIndex });

  console.log(
    `🏁 Batch complete — ${totalLeads} leads saved. Next start index: ${globalIndex}`
  );

  return {
    processed: batch.length,
    totalLeads,
    nextStartIndex: globalIndex,
  };
}
