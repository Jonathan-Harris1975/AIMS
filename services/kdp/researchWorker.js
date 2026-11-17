import { claimDurableLease, releaseDurableLease } from "../shared/utils/durableLease.js";
import { getObjectAsText, putPrivateJson, parseR2Reference, listObjects } from "../shared/utils/r2-client.js";
import { hasDurableStateEnv } from "../shared/utils/durableStateEnv.js";
import { listKdpEbooks } from "./catalogue.js";
import { readKdpAuditReport, readKdpMetadataSnapshot } from "./storage.js";
import { discoverBookResearch } from "./researchDiscovery.js";
import { captureCompetitorEvidence } from "./researchEvidence.js";
import { draftOptimisation } from "./optimisationProposal.js";
import { inWeeklyWindow, londonTime, selectWeeklyBatch } from "./weeklyResearch.js";

import { queueOptimisation, runOptimisationUpdates } from "./optimisationUpdates.js";

const KEY = "research/weekly/state.json";

export function londonWeek(date) {
  const local = londonTime(date);
  const day = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

// A fixed UTC Monday anchor creates stable, non-overlapping 28-day cycles.
export function reviewCycle(date) {
  const monday = londonWeek(date);
  const weeks = Math.floor((Date.parse(monday + "T00:00:00Z") - Date.parse("2026-10-26T00:00:00Z")) / (7 * 86400000));
  const start = new Date(Date.parse("2026-10-26T00:00:00Z") + Math.floor(weeks / 4) * 28 * 86400000);
  return start.toISOString().slice(0, 10);
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

const MAX_TECHNICAL_ATTEMPTS_PER_BOOK = 2;

// Persist identifiers, not provider text or source snippets, in operational failure records.
export function researchFailureDetail(error, stage) {
  const code = String(error?.code || error?.name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'unknown';
  const status = Number(error?.statusCode ?? error?.status);
  const sanitise = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  return { stage, code, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
    ...(error?.freeFailure ? { freeFailure: sanitise(error.freeFailure) } : {}),
    ...(error?.paidFailure ? { paidFailure: sanitise(error.paidFailure) } : {}) };
}

export function countTechnicalFailures(results = []) {
  return results.filter((result) => result.optimisation?.technical === true ||
    result.updateDispatch?.ok === false).length;
}

export async function runResearchTick({
  now = () => new Date(), env = process.env, readState = () => readJson(KEY),
  writeState = (state) => putPrivateJson("kdp", KEY, state),
  archive = (week, state) => putPrivateJson("kdp", `research/weekly/${week}.json`, state),
  getAudit = latestAudit, getBooks = listKdpEbooks, discover = discoverBookResearch, captureEvidence = captureCompetitorEvidence,
  getMetadata = readKdpMetadataSnapshot, draft = draftOptimisation, queueUpdate = queueOptimisation, updateTick = runOptimisationUpdates,
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
    await updateTick();
    const week = londonWeek(started);
    const cycle = reviewCycle(started);
    const state = await readState() || { cursor: 0 };
    if (state.week !== week) {
      const audit = await getAudit(started);
      if (!validMondayAudit(audit, started)) return { status: "monday_audit_unavailable" };
      if (state.week && !state.completed) await archive(state.week, state);
      const currentCatalogue = await getBooks();
      const limit = batchSize(env);
      const selection = selectWeeklyBatch(currentCatalogue, state.cursor || 0, limit);
      if (!selection.books.length) return { status: "no_eligible_books" };
      // Resume unfinished work first. Retest up to 20% of the last batch's
      // technical failures so one broken title cannot starve the whole catalogue.
      const byId = new Map(currentCatalogue.map((item) => [item.ebookId, item]));
      const carryPending = (state.pending || []).map((item) => byId.get(item.ebookId)).filter(Boolean);
      const failed = (state.results || []).filter((item) => item.optimisation?.technical === true ||
        item.updateDispatch?.ok === false).map((item) => byId.get(item.ebookId)).filter(Boolean)
        .slice(0, Math.max(1, Math.ceil(limit / 5)));
      const next = new Map();
      for (const item of [...carryPending, ...failed, ...selection.books]) {
        if (next.size >= limit) break;
        if (Number.isSafeInteger(item.ebookId) && item.ebookId > 0) next.set(item.ebookId, item);
      }
      state.week = week;
      state.cycle = cycle;
      state.auditRunId = audit.runId;
      state.pending = [...next.values()];
      state.auditEvidence = (audit.publicAudit?.listings || []).map((row) => ({
        ebookId: row.ebookId, publicListing: row.publicListing,
      }));
      state.results = [];
      state.inProgress = null;
      state.technicalRetry = null;
      state.lastTechnicalFailure = null;
      state.completed = false;
      await writeState(state);
    }
    if (state.completed) return { status: "already_complete", week, cycle, listingUpdates: 0,
      proposalCounts: countProposals(state.results), technicalFailures: countTechnicalFailures(state.results) };
    if (state.pending.length && inWeeklyWindow(now(), "update") && londonWeek(now()) === week) {
      const book = state.pending[0];
      const recordFailure = async (stage, error, partial = {}) => {
        const attempts = state.technicalRetry?.ebookId === book.ebookId ? state.technicalRetry.attempts + 1 : 1;
        const detail = researchFailureDetail(error, stage);
        state.lastTechnicalFailure = { ebookId: book.ebookId, ...detail, attempts, at: now().toISOString() };
        state.technicalRetry = { ebookId: book.ebookId, attempts };
        if (attempts >= MAX_TECHNICAL_ATTEMPTS_PER_BOOK) {
          state.results.push({ ...partial, ebookId: book.ebookId, optimisation: {
            status: "blocked", reason: "technical_failure", technical: true, failure: detail,
          } });
          state.pending.shift();
          state.cursor = book.ebookId;
          state.inProgress = null;
          state.technicalRetry = null;
        }
        state.updatedAt = now().toISOString();
        await writeState(state);
        if (!state.pending.length) {
          state.completed = true;
          await archive(week, state);
          await writeState(state);
        }
        return { status: state.completed ? "complete" : "pending", week, cycle,
          processed: state.results.length, pending: state.pending.length,
          technicalFailures: countTechnicalFailures(state.results), lastTechnicalFailure: state.lastTechnicalFailure,
          technicalRetryScheduled: attempts < MAX_TECHNICAL_ATTEMPTS_PER_BOOK };
      };
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
        try { result = await discover(book, { apiKey: env.TAVILY_SEARCH_API, now, beforeRequest }); }
        catch (error) {
          if (error?.code === 'research_monthly_limit') {
            state.lastTechnicalFailure = { ebookId: book.ebookId,
              ...researchFailureDetail(error, "discovery"), at: now().toISOString() };
            await writeState(state);
            return { status: 'research_monthly_limit', week, ebookId: book.ebookId };
          }
          return recordFailure("discovery", error);
        }
        state.inProgress = result;
        await writeState(state);
      }
      const auditedBook = state.auditEvidence?.find((row) => row.ebookId === book.ebookId)?.publicListing;
      if (auditedBook?.status === "captured" && auditedBook.data?.asin === book.asin) {
        const recommended = (auditedBook.data.recommendedAsins || []).filter((asin) => /^B0[A-Z0-9]{8}$/.test(asin) && asin !== book.asin).slice(0, 3);
        result.competitors ||= {};
        for (const market of ["US", "UK"]) {
          const leads = recommended.map((asin) => ({ asin, url: `https://www.amazon.${market === "US" ? "com" : "co.uk"}/dp/${asin}`, source: "amazon_recommendation" }));
          result.competitors[market] = [...leads, ...(result.competitors[market] || [])].filter((lead, i, all) => all.findIndex((x) => x.asin === lead.asin) === i);
        }
      }
      try { result.competitorEvidence = await captureEvidence(result); }
      catch (error) { return recordFailure("competitor_evidence", error, result); }
      if (Object.values(result.competitorEvidence.markets).some((market) => market.status === "blocked")) {
        return { status: "amazon_blocked", week, ebookId: book.ebookId };
      }
      try {
        let liveListing = state.auditEvidence?.find((row) => row.ebookId === book.ebookId);
        if (!liveListing) {
          const currentAudit = await getAudit(started);
          liveListing = currentAudit?.runId === state.auditRunId
            ? currentAudit.publicAudit?.listings?.find((row) => row.ebookId === book.ebookId)
            : null;
        }
        result.optimisation = await draft(book, result, await getMetadata(), { now: now(), liveListing });
      } catch (error) {
        return recordFailure("proposal", error, result);
      }
      if (result.optimisation?.status === "approved") {
        try { result.update = await queueUpdate(week, book, result.optimisation); }
        catch (error) { return recordFailure("queue", error, result); }
      }
      state.results.push(result);
      state.inProgress = null;
      state.cursor = book.ebookId;
      state.pending.shift();
      state.technicalRetry = null;
      state.updatedAt = now().toISOString();
      // Cursor and result are committed together. A crash can repeat a search,
      // but cannot silently skip an ebook or trigger a KDP listing update.
      await writeState(state);
      // A final research tick can otherwise leave a prepared update stranded
      // until after Thursday's submission cutoff. Reconcile immediately.
      if (result.update?.status === "prepared") {
        try { result.updateDispatch = await updateTick(); }
        catch (error) { result.updateDispatch = { ok: false, status: "update_dispatch_failed",
          failure: researchFailureDetail(error, "update_dispatch") }; }
        await writeState(state);
      }
    }
    if (!state.pending.length) { state.completed = true; await archive(week, state); await writeState(state); }
    return { status: state.completed ? "complete" : "pending", week, cycle, processed: state.results.length, pending: state.pending.length,
      listingUpdates: 0, proposalCounts: countProposals(state.results),
      technicalFailures: countTechnicalFailures(state.results) };
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
    if (["complete", "already_complete"].includes(result.status)) return {
      ...result, ok: !(result.technicalFailures > 0),
    };
    if (result.status === "already_running") return { ...result, ok: true };
    // A missing audit, search key, provider outage or blocked marketplace must
    // fail the MAST terminal check. Calling that a successful skip hid failures.
    return { ...result, ok: false };
  }
}
