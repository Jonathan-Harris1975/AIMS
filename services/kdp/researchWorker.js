import { claimDurableLease, releaseDurableLease } from "../shared/utils/durableLease.js";
import { getObjectAsText, putPrivateJson, parseR2Reference } from "../shared/utils/r2-client.js";
import { hasDurableStateEnv } from "../shared/utils/durableStateEnv.js";
import { listKdpEbooks } from "./catalogue.js";
import { readKdpAuditReport } from "./storage.js";
import { discoverBookResearch } from "./researchDiscovery.js";
import { inWeeklyWindow, londonTime, selectWeeklyBatch } from "./weeklyResearch.js";
import { warn } from "../../logger.js";

const KEY = "research/weekly/state.json";
let timer;
let running;

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

async function latestAudit() {
  const pointer = await readJson("audit/reports/latest.json");
  const parsed = pointer?.reportRef && parseR2Reference(pointer.reportRef);
  if (!parsed?.key?.startsWith("audit/reports/")) return null;
  return readKdpAuditReport(parsed.key);
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
  getAudit = latestAudit, getBooks = listKdpEbooks, discover = discoverBookResearch,
  claim = claimDurableLease, release = releaseDurableLease,
} = {}) {
  const started = now();
  if (!inWeeklyWindow(started, "update")) return { status: "outside_window" };
  if (!env.BRAVE_SEARCH_API_KEY) return { status: "search_not_configured" };
  if (!hasDurableStateEnv(env) || ["local", "file", "filesystem"].includes(String(env.STATE_BACKEND || "").toLowerCase())) return { status: "durable_state_not_configured" };
  const acquired = await claim({ namespace: "kdp-research", key: "weekly-research-worker", pendingTtlMs: 60 * 60 * 1000 });
  if (!acquired.claimed) return { status: "already_running" };
  try {
    if (acquired.lease.backend !== "r2") return { status: "durable_state_not_configured" };
    const week = londonWeek(started);
    const state = await readState() || { cursor: 0 };
    if (state.week !== week) {
      const audit = await getAudit();
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
    if (state.completed) return { status: "already_complete", week };
    if (state.pending.length && inWeeklyWindow(now(), "update") && londonWeek(now()) === week) {
      const book = state.pending[0];
      const result = await discover(book, { apiKey: env.BRAVE_SEARCH_API_KEY, now });
      state.results.push(result);
      state.cursor = book.ebookId;
      state.pending.shift();
      state.updatedAt = now().toISOString();
      // Cursor and result are committed together. A crash can repeat a search,
      // but cannot silently skip an ebook or trigger a KDP listing update.
      await writeState(state);
    }
    if (!state.pending.length) { state.completed = true; await archive(week, state); await writeState(state); }
    return { status: state.completed ? "complete" : "waiting_for_window", week, processed: state.results.length, pending: state.pending.length };
  } finally { await release(acquired.lease); }
}

export function startKdpResearchWorker() {
  if (timer || !process.env.BRAVE_SEARCH_API_KEY) return;
  const tick = () => {
    if (running) return;
    running = runResearchTick().catch((error) => warn("kdp.research.worker", { error: String(error?.message || error).slice(0, 200) })).finally(() => { running = undefined; });
  };
  timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
}

export function stopKdpResearchWorker() { if (timer) clearInterval(timer); timer = undefined; }
