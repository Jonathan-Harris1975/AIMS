import fs from "fs";
import path from "path";

import { wait } from "../../shared/utils/wait.js";
import { log, info } from "../../../logger.js";

import { runKeyword } from "./outreachService.js";

/* ============================================================
   Batch progress (local file – not env-driven)
============================================================ */

const PROGRESS_FILE = path.resolve(
  process.cwd(),
  "services/outreach/data/batch-progress.json"
);

function parseKeywords(raw) {
  if (!raw) return [];

  return String(raw)
    .split(/\r?\n|,/) 
    .map((value) => value.trim())
    .filter(Boolean);
}

function loadProgress() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) {
      return { lastProcessedIndex: 0 };
    }
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  } catch (err) {
    log.error("❌ Failed to load batch progress:", err);
    return { lastProcessedIndex: 0 };
  }
}

function saveProgress(progress) {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (err) {
    log.error("❌ Failed to save batch progress:", err);
  }
}

/* ============================================================
   Batch runner
============================================================ */

export async function runNextBatch() {
  const keywords = parseKeywords(process.env.OUTREACH_KEYWORDS);
  if (!keywords.length) {
    info("ℹ️ No outreach keywords configured");
    return { processed: 0, done: true };
  }

  const progress = loadProgress();
  let index = progress.lastProcessedIndex;

  const batchSize = Number(process.env.OUTREACH_BATCH_SIZE) || 0;
  const delayMs = Number(process.env.SERP_RATE_DELAY_MS) || 0;

  if (batchSize <= 0) {
    info("ℹ️ OUTREACH_BATCH_SIZE is not configured");
    return { processed: 0, done: true, lastProcessedIndex: index };
  }

  let processed = 0;

  while (index < keywords.length && processed < batchSize) {
    const keyword = keywords[index];

    info(`🔎 Outreach batch keyword [${index}]: ${keyword}`);
    await runKeyword(keyword);

    index++;
    processed++;

    saveProgress({ lastProcessedIndex: index });

    if (delayMs > 0) {
      await wait(delayMs);
    }
  }

  const done = index >= keywords.length;

  if (done) {
    info("🏁 Outreach batch completed");
  }

  return {
    processed,
    done,
    lastProcessedIndex: index,
  };
}

/* ============================================================
   Progress reset
============================================================ */

export function resetProgress(lastProcessedIndex = 0) {
  const index =
    Number.isFinite(lastProcessedIndex) && lastProcessedIndex >= 0
      ? lastProcessedIndex
      : 0;

  saveProgress({ lastProcessedIndex: index });

  info(`🔄 Outreach progress reset to index ${index}`);

  return { lastProcessedIndex: index };
}
