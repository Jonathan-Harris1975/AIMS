// services/outreach/services/batchService.js

import fs from "fs";
import path from "path";
import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { appendLeadRows } from "./sheetService.js";
import { loadProgress, saveProgress } from "../utils/r2ProgressStore.js";
import { ENV } from "#scripts/envBootstrap.js";
import { wait } from "#shared/utils/wait.js";

const KEYWORDS_FILE =
  ENV.OUTREACH_KEYWORDS_FILE || "services/outreach/keywords.txt";

function loadKeywords() {
  return fs
    .readFileSync(path.resolve(KEYWORDS_FILE), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function runNextBatch() {
  const keywords = loadKeywords();
  const progress = await loadProgress();

  const start = progress.lastProcessedIndex;
  const batch = keywords.slice(start, start + ENV.OUTREACH_BATCH_SIZE);

  let globalIndex = start;
  let totalLeads = 0;

  for (const keyword of batch) {
    const result = await serpOutreach(keyword);
    const good = extractGoodLeads(result, keyword);

    if (good.length) {
      await appendLeadRows(
        good.map((r) => [
          r.timestamp,
          r.keyword,
          r.domain,
          r.da,
          r.serpPosition ?? null,
          r.email,
          r.emailScore,
          r.leadScore,
        ])
      );
      totalLeads += good.length;
    }

    globalIndex++;
    await wait(ENV.SERP_RATE_DELAY_MS);
  }

  await saveProgress({ lastProcessedIndex: globalIndex });

  return {
    processed: batch.length,
    totalLeads,
    nextStartIndex: globalIndex,
  };
          }
