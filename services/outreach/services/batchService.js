import fs from "fs";
import path from "path";

import { wait } from "../../shared/utils/wait.js";
import { loadOutreachKeywords } from "../utils/keywordLoader.js";
import { durableStateEnvHint, hasDurableStateEnv } from "../../shared/utils/durableStateEnv.js";
import { info, warn } from "../../../logger.js";
import { isAuthorisedOutreachSession, londonParts } from "../utils/schedule.js";
import { GuestArticleRunRepository } from "./guestArticleRunRepository.js";

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

let batchRunning = false;

function positiveInt(name, fallback, min = 1, max = 1440) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function runBatchWork({ triggerRunKey = "", recovering = false, clock = () => Date.now(), assertLease = async () => {} } = {}) {
  if (batchRunning) return { processed: 0, skipped: true, reason: "OUTREACH_BATCH_ALREADY_RUNNING" };
  batchRunning = true;
  try {
    const keywordConfig = loadOutreachKeywords();
    const { keywords } = keywordConfig;
    if (!keywords.length) {
      info("outreach.batch.keywords.none", { source: keywordConfig.source, filePath: keywordConfig.filePath, fileFound: keywordConfig.found });
      return { processed: 0, done: true, skipped: true, reason: "NO_OUTREACH_KEYWORDS", keywordSource: keywordConfig.source, keywordFilePath: keywordConfig.filePath,
         keywordFileFound: keywordConfig.found, keywordCount: 0 };
    }

    const progress = await loadProgress();
    const now = clock();
    const minIntervalMs = positiveInt("OUTREACH_TRIGGER_MIN_INTERVAL_MINUTES", 300, 1, 1440) * 60_000;
    const lastTriggeredAt = Date.parse(progress.lastTriggeredAt || "");
    if (!recovering && Number.isFinite(lastTriggeredAt) && now - lastTriggeredAt < minIntervalMs) {
      return {
        processed: 0, skipped: true, reason: "OUTREACH_TRIGGER_COOLDOWN",
        nextAllowedAt: new Date(lastTriggeredAt + minIntervalMs).toISOString(),
        lastProcessedIndex: Number(progress.lastProcessedIndex) || 0,
      };
    }

    const batchSize = Number(process.env.OUTREACH_BATCH_SIZE) || 0;
    const delayMs = Number(process.env.SERP_RATE_DELAY_MS) || 0;
    if (batchSize <= 0) return { processed: 0, done: true, skipped: true, reason: "OUTREACH_BATCH_SIZE_NOT_CONFIGURED", keywordSource: keywordConfig.source, keywordCount: keywords.length };

    const cycle = parseBoolean(process.env.OUTREACH_BATCH_CYCLE, true);
    let index = Number(progress.lastProcessedIndex) || 0;
    if (index >= keywords.length && cycle) index = 0;
    if (index >= keywords.length) return { processed: 0, done: true, skipped: true, reason: "OUTREACH_KEYWORDS_COMPLETE", lastProcessedIndex: index, keywordCount: keywords.length };

    const trigger = String(triggerRunKey || "").trim().slice(0, 200);
    await assertLease();
    await saveProgress({
      ...progress,
      lastProcessedIndex: index,
      batchSize,
      lastTriggeredAt: new Date(now).toISOString(),
      lastTriggerRunKey: trigger || progress.lastTriggerRunKey || null,
    });
    let processed = 0;
    const automation = { sent: 0, queued: 0, skipped: 0, failed: 0 };
    const results = [];
    while (processed < batchSize && keywords.length) {
      await assertLease();
      if (index >= keywords.length) {
        if (!cycle) break;
        index = 0;
      }
      const keyword = keywords[index];
      info("outreach.batch.keyword", { index, keyword });
      const result = await runKeyword(keyword, { assertLease });
      results.push({ keyword, savedLeads: result.savedLeads, automation: result.automation || null });
      for (const key of Object.keys(automation)) automation[key] += Number(result?.automation?.[key] || 0);
      index += 1;
      processed += 1;
      await assertLease();
      await saveProgress({
        lastProcessedIndex: index,
        batchSize,
        lastTriggeredAt: new Date(now).toISOString(),
        lastTriggerRunKey: trigger || progress.lastTriggerRunKey || null,
      });
      if (delayMs > 0 && processed < batchSize) await wait(delayMs);
      if (!cycle && index >= keywords.length) break;
    }
    const done = !cycle && index >= keywords.length;
    return {
      processed,
      done,
      cycle,
      lastProcessedIndex: index,
      triggerRunKey: trigger || null,
      keywordSource: keywordConfig.source,
      keywordCount: keywords.length,
      automation,
      results,
    };
  } finally {
    batchRunning = false;
  }
}

function safeRunResult(result) {
  const countAutomation = (automation = {}) => {
    const counts = automation || {};
    return {
      sent: Number(counts.sent || 0),
      queued: Number(counts.queued || 0),
      skipped: Number(counts.skipped || 0),
      failed: Number(counts.failed || 0),
    };
  };
  return {
    processed: Number(result.processed || 0),
    done: result.done === true,
    cycle: result.cycle === true,
    lastProcessedIndex: Number(result.lastProcessedIndex || 0),
    triggerRunKey: result.triggerRunKey || null,
    keywordSource: result.keywordSource || null,
    keywordCount: Number(result.keywordCount || 0),
    automation: countAutomation(result.automation),
    results: (Array.isArray(result.results) ? result.results : []).map((item) => ({
      keyword: String(item.keyword || "").slice(0, 180),
      savedLeads: Number(item.savedLeads || 0),
      automation: countAutomation(item.automation),
    })),
  };
}

export async function runNextBatch({ triggerRunKey = "", now = () => new Date(),
  getContext = async () => {
    const runtime = await import("../../comms-hub/runtime.js");
    return runtime.getCommsHubContext();
  }, execute = runBatchWork } = {}) {
  const current = now();
  if (!isAuthorisedOutreachSession(current)) {
    return { processed: 0, skipped: true, status: "blocked", reason: "OUTSIDE_AUTHORISED_GUEST_ARTICLE_SESSION" };
  }
  if (!parseBoolean(process.env.AIMS_OPERATION_OUTREACH_ENABLED, false)) {
    return { processed: 0, skipped: true, status: "blocked", reason: "GUEST_ARTICLE_OPERATION_DISABLED" };
  }

  const context = await getContext();
  if (!context?.d1) throw new Error("Durable Comms Hub D1 is required for Guest Article occurrence control.");
  const ledger = new GuestArticleRunRepository(context.d1, { now });
  const localDate = londonParts(current).date;
  const lease = await ledger.claim(localDate, triggerRunKey);
  if (!lease.acquired) {
    return { processed: 0, skipped: true, duplicate: lease.completed,
      status: lease.status, reason: lease.completed ? "GUEST_ARTICLE_OCCURRENCE_ALREADY_TERMINAL" : "GUEST_ARTICLE_OCCURRENCE_ALREADY_RUNNING_OR_EXHAUSTED",
      occurrenceId: lease.occurrenceId, attempts: lease.attempts, previousResult: lease.result };
  }

  let leaseError = null;
  let renewalInFlight = null;
  const renewLease = async () => {
    if (leaseError) throw leaseError;
    if (renewalInFlight) return renewalInFlight;
    renewalInFlight = (async () => {
      if (!await ledger.renew(lease)) {
        leaseError = Object.assign(new Error("Guest Article run lease was lost."), { code: "GUEST_ARTICLE_LEASE_LOST" });
        throw leaseError;
      }
    })();
    try { await renewalInFlight; } finally { renewalInFlight = null; }
  };
  const assertLease = async () => {
    if (leaseError) throw leaseError;
    if (!await ledger.assertOwned(lease)) {
      leaseError = Object.assign(new Error("Guest Article run lease expired or was taken."), { code: "GUEST_ARTICLE_LEASE_LOST" });
      throw leaseError;
    }
  };
  const heartbeat = setInterval(() => {
    void renewLease().catch(() => {});
  }, Math.max(1000, Math.floor(ledger.leaseMs / 3)));
  heartbeat.unref?.();

  try {
    await renewLease();
    const result = await execute({ triggerRunKey, recovering: lease.attempt > 1,
      clock: () => current.getTime(), assertLease });
    await assertLease();
    const status = result.processed > 0
      ? (Number(result.automation?.sent || 0) > 0 ? "completed" : "completed_zero")
      : "blocked";
    await ledger.finish(lease, status, { result: safeRunResult(result), errorCode: status === "blocked" ? result.reason : null });
    return { ...result, status, occurrenceId: lease.occurrenceId, attempt: lease.attempt };
  } catch (error) {
    try {
      await ledger.finish(lease, "failed", { errorCode: error?.code || "guest_article_run_failed" });
    } catch (finishError) {
      if (error && typeof error === "object") error.finishError = finishError;
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

/* ============================================================
   Progress reset
============================================================ */

export async function resetProgress(lastProcessedIndex = 0) {
  const index = Number.isFinite(lastProcessedIndex) && lastProcessedIndex >= 0 ? lastProcessedIndex : 0;
  const progress = await saveProgress({ lastProcessedIndex: index, lastTriggeredAt: null });
  info(`🔄 Outreach progress reset to index ${index}`);
  return { lastProcessedIndex: Number(progress.lastProcessedIndex) || 0 };
}
