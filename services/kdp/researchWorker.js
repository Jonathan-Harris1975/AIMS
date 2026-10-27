import { claimDurableLease, releaseDurableLease } from "../shared/utils/durableLease.js";
import { getObjectAsText, putPrivateJson, parseR2Reference, listObjects } from "../shared/utils/r2-client.js";
import { hasDurableStateEnv } from "../shared/utils/durableStateEnv.js";
import { listKdpEbooks } from "./catalogue.js";
import { readKdpAuditReport, readKdpMetadataSnapshot } from "./storage.js";
import { discoverBookResearch } from "./researchDiscovery.js";
import { captureCompetitorEvidence } from "./researchEvidence.js";
import { draftOptimisation } from "./optimisationProposal.js";
import { inWeeklyWindow, londonTime, selectWeeklyBatch } from "./weeklyResearch.js";

const KEY = "research/weekly/state.json";

export function londonWeek(date) {
  const local = londonTime(date);
  const day = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function validMondayAudit(report, now) {
  if (!report || report.mode !== "public" || report.ok !== true || report.complete !== true) return false;
  const created = new Date(report.createdAt);
  const completed = new Date(report.completedAt);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(completed.getTime()) || completed > now || completed < created) return false;
  return londonWeek(created) === londonWeek(now) && inWeeklyWindow(created, "audit");
}

async function readJson(key) {
  try { return JSON.parse(await getObjectAsText("kdp", key)); }
  catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function readWeeklyResearchState() { return readJson(KEY); }

export async function latestAudit(now, { readPointer = () => readJson("audit/reports/latest.json"),
  readReport = readKdpAuditReport, listReports = listObjects } = {}) {
  const pointer = await readPointer();
  const parsed = pointer?.reportRef && parseR2Reference(pointer.reportRef);
  if (parsed?.key?.startsWith("audit/reports/")) {
    const latest = await readReport(parsed.key);
    if (validMondayAudit(latest, now)) return latest;
  }
  // Other audit modes can replace latest.json; inspect this week's Monday
  // reports instead of discarding a valid public audit.
  const monday = londonWeek(now);
  const objects = await listReports("kdp", `audit/reports/${monday}/`);
  const reports = [];
  for (const object of objects) {
    const report = await readReport(object.key);
    if (validMondayAudit(report, now)) reports.push(report);
  }
  reports.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return reports[0] || null;
}

function batchSize(env) {
  const value = Number(env.KDP_RESEARCH_BATCH_SIZE || 15);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("KDP_RESEARCH_BATCH_SIZE must be between 1 and 100");
  return value;
}

export async function runResearchTick({
  now = () => new Date(), env = process.env, readState = () => readJson(KEY),
  writeState = (state) => putPrivateJson("kdp", KEY, state),
  archive = (week, state) => putPrivateJson("kdp", `research/weekly/${week}.json`, state),
  getAudit = latestAudit, getBooks = listKdpEbooks, discover = discoverBookResearch, captureEvidence = captureCompetitorEvidence,
  getMetadata = readKdpMetadataSnapshot, draft = draftOptimisation,
  claim = claimDurableLease, release = releaseDurableLease,
} = {}) {
  const started = now();
  if (!inWeeklyWindow(started, "update")) return { status: "outside_window" };
  if (!env.TAVILY_SEARCH_API) return { status: "search_not_configured" };
  if (!hasDurableStateEnv(env) || ["local", "file", "filesystem"].includes(String(env.STATE_BACKEND || "").toLowerCase())) return { status: "durable_state_not_configured" };
  const acquired = await claim({ namespace: "kdp-research", key: "weekly-research-worker", pendingTtlMs: 60 * 60 * 1000 });
  if (!acquired.claimed) return { status: "already_running" };
  try {
    if (acquired.lease.backend !== "r2") return { status: "durable_state_not_configured" };
    const week = londonWeek(started);
    const state = await readState() || { cursor: 0 };
    if (state.week !== week) {
      const audit = await getAudit(started);
      if (!validMondayAudit(audit, started)) return { status: "monday_audit_unavailable" };
      if (state.week && !state.completed) await archive(state.week, state);
      const carryOver = Array.isArray(state.pending) && state.pending.length ? state.pending : null;
      const selection = carryOver ? { books: carryOver } : selectWeeklyBatch(await getBooks(), state.cursor || 0, batchSize(env));
      if (!selection.books.length) return { status: "no_eligible_books" };
      state.week = week;
      state.auditRunId = audit.runId;
      state.pending = selection.books;
      state.results = [];
      state.completed = false;
      await writeState(state);
    }
    if (state.completed) return { status: "already_complete", week, listingUpdates: 0, proposalCounts: countProposals(state.results) };
    if (state.pending.length && inWeeklyWindow(now(), "update") && londonWeek(now()) === week) {
      const book = state.pending[0];
      const maxRequests = Number(env.KDP_RESEARCH_MONTHLY_SEARCH_LIMIT || 900);
      if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new Error("Invalid monthly research limit");
      const beforeRequest = async () => {
        const current = londonTime(now());
        const month = `${current.year}-${current.month}`;
        if (state.usageMonth !== month) { state.usageMonth = month; state.requestsReserved = 0; }
        if (state.requestsReserved >= maxRequests) {
          const error = new Error("Monthly search limit reached");
          error.code = "research_monthly_limit";
          throw error;
        }
        state.requestsReserved += 1;
        await writeState(state);
      };
      let result = state.inProgress;
      if (!result || result.ebookId !== book.ebookId) {
        result = await discover(book, { apiKey: env.TAVILY_SEARCH_API, now, beforeRequest });
        state.inProgress = result;
        await writeState(state);
      }
      result.competitorEvidence = await captureEvidence(result);
      if (Object.values(result.competitorEvidence.markets).some((market) => market.status === "blocked")) {
        return { status: "amazon_blocked", week, ebookId: book.ebookId };
      }
      try {
        result.optimisation = await draft(book, result, await getMetadata(), { now: now() });
      } catch {
        result.optimisation = { status: "blocked", reason: "proposal_unavailable", listingUpdated: false };
      }
      state.results.push(result);
      state.inProgress = null;
      state.cursor = book.ebookId;
      state.pending.shift();
      state.updatedAt = now().toISOString();
      // Cursor and result are committed together. A crash can repeat a search,
      // but cannot silently skip an ebook or trigger a KDP listing update.
      await writeState(state);
    }
    if (!state.pending.length) { state.completed = true; await archive(week, state); await writeState(state); }
    return { status: state.completed ? "complete" : "pending", week, processed: state.results.length, pending: state.pending.length,
      listingUpdates: 0, proposalCounts: countProposals(state.results) };
  } finally { await release(acquired.lease); }
}

function countProposals(results = []) {
  const counts = {};
  for (const item of results) {
    const status = item.optimisation?.status || "unavailable";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

export async function runResearchBatch({ tick = runResearchTick, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (;;) {
    const result = await tick();
    if (result.status === "pending") { await pause(60_000); continue; }
    if (["complete", "already_complete"].includes(result.status)) return { ok: true, ...result };
    return { ok: false, ...result };
  }
}
