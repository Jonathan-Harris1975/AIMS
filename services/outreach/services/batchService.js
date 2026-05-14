import fs from "fs";
import path from "path";

import { wait } from "../../shared/utils/wait.js";
import { durableStateEnvHint, hasDurableStateEnv } from "../../shared/utils/durableStateEnv.js";
import { info, warn } from "../../../logger.js";

import { runKeyword } from "./outreachService.js";
import {
  loadProgress as loadR2Progress,
  saveProgress as saveR2Progress,
} from "../utils/r2ProgressStore.js";

/* ============================================================
   Batch progress
   - Prefer R2/metasystem for hosted runtimes (Koyeb, containers)
   - Fall back to local file storage only outside production, or when
     ALLOW_EPHEMERAL_STATE=true explicitly opts into state loss.
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isProductionEnv(value = process.env.NODE_ENV) {
  return String(value || "").trim().toLowerCase() === "production";
}

function hasDurableR2ProgressEnv() {
  return hasDurableStateEnv(process.env);
}

function canUseLocalFallback() {
  return !isProductionEnv() || parseBoolean(process.env.ALLOW_EPHEMERAL_STATE, false);
}

function ensureLocalFallbackAllowed(reason) {
  if (canUseLocalFallback()) {
    return;
  }

  throw new Error(
    `${reason}. Outreach batch progress cannot fall back to local filesystem state in production. ${durableStateEnvHint()}`
  );
}

function loadLocalProgress() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) {
      return { lastProcessedIndex: 0 };
    }
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  } catch (err) {
    warn("outreach.progress.local.load.fail", { error: err?.message });
    return { lastProcessedIndex: 0 };
  }
}

function saveLocalProgress(progress) {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    return progress;
  } catch (err) {
    warn("outreach.progress.local.save.fail", { error: err?.message });
    return progress;
  }
}

async function loadProgress() {
  if (hasDurableR2ProgressEnv()) {
    try {
      return await loadR2Progress();
    } catch (err) {
      warn("outreach.progress.r2.load.fail", { error: err?.message });
      ensureLocalFallbackAllowed("Durable outreach progress load failed");
    }
  } else {
    ensureLocalFallbackAllowed("Durable outreach progress is not configured");
  }

  return loadLocalProgress();
}

async function saveProgress(progress) {
  if (hasDurableR2ProgressEnv()) {
    try {
      return await saveR2Progress(progress);
    } catch (err) {
      warn("outreach.progress.r2.save.fail", { error: err?.message });
      ensureLocalFallbackAllowed("Durable outreach progress save failed");
    }
  } else {
    ensureLocalFallbackAllowed("Durable outreach progress is not configured");
  }

  return saveLocalProgress(progress);
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

  const progress = await loadProgress();
  let index = Number(progress.lastProcessedIndex) || 0;

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

    await saveProgress({ lastProcessedIndex: index, batchSize });

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

export async function resetProgress(lastProcessedIndex = 0) {
  const index =
    Number.isFinite(lastProcessedIndex) && lastProcessedIndex >= 0
      ? lastProcessedIndex
      : 0;

  const progress = await saveProgress({ lastProcessedIndex: index });

  info(`🔄 Outreach progress reset to index ${index}`);

  return { lastProcessedIndex: Number(progress.lastProcessedIndex) || 0 };
}
