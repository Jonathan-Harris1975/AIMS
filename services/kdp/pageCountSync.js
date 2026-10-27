import { getKdpEbookById, updateKdpEbookPageCount } from "./catalogue.js";
import { purgeCloudflareCache, resolveCloudflarePurgeConfig } from "../cloudflare-purge/utils/purgeCloudflareCache.js";
import { deleteObject, getObjectAsText, listObjects, putPrivateJson } from "../shared/utils/r2-client.js";
import { log } from "../../logger.js";

const PREFIX = "audit/page-count-sync/pending/";
const API_URL = "https://jonathan-harris.online/api/v1/ebooks.json";
const INTERVAL_MS = 5 * 60 * 1000;
const REBUILD_RETRY_MS = 20 * 60 * 1000;
let timer;
let running;

function validSlug(slug) {
  return typeof slug === "string" && slug.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function pageCountCandidates(audit) {
  return (audit?.listings || []).flatMap((row) => {
    const data = row.publicListing?.data;
    const book = row.catalogue;
    const asin = String(book?.asin || "").trim().toUpperCase();
    const before = book?.pageCount ?? null;
    const after = data?.pageCount;
    if (row.publicListing?.status !== "captured" || data?.asin !== asin || !/^B0[A-Z0-9]{8}$/.test(asin) ||
        data?.pageCountSource !== "print_length" || !Number.isSafeInteger(after) || after < 1 || after > 10000 ||
        !(before === null || (Number.isSafeInteger(before) && before >= 0)) || before === after ||
        !Number.isSafeInteger(book?.ebookId) || !validSlug(book?.slug)) return [];
    return [{ ebookId: book.ebookId, asin, slug: book.slug, previousPageCount: before, pageCount: after,
      sourceUrl: row.url, checkedAt: row.publicListing.checkedAt }];
  });
}

async function loadIntent(key) {
  return JSON.parse(await getObjectAsText("kdp", key));
}

function configuredHooks(env) {
  return [env.WEBSITE_REBUILD_HOOK, env.WEBSITE_REBUILD_HOOK_FALLBACK].map((v) => String(v || "").trim()).filter(Boolean);
}

async function triggerRebuild(env = process.env) {
  for (const hook of configuredHooks(env)) {
    try {
      const response = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(15000) });
      if (response.ok) return { ok: true, status: response.status };
    } catch { /* Try the fallback without logging the secret hook. */ }
  }
  return { ok: false, reason: "website_rebuild_hook_failed" };
}

export function websiteShowsCount(html, asin, count) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const values = Array.isArray(data) ? data : [data];
      for (const item of values) {
        const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
        const identifiers = Array.isArray(item?.identifier) ? item.identifier : [item?.identifier];
        const sameAsin = identifiers.some((id) => id?.propertyID === "ASIN" && String(id?.value).toUpperCase() === asin);
        const visibleLength = new RegExp(`<strong>\\s*Length:\\s*<\\/strong>\\s*${count}\\s+pages`, "i").test(html);
        if (types.includes("Book") && sameAsin && Number(item.numberOfPages) === count && visibleLength) return true;
      }
    } catch { /* Invalid or unrelated schema is not confirmation. */ }
  }
  return false;
}

async function verifyWebsite(items, fetchImpl = fetch) {
  const results = [];
  for (const item of items) {
    if (!validSlug(item.slug)) { results.push(false); continue; }
    const url = `https://jonathan-harris.online/ebooks/${item.slug}/?page-count-check=${Date.now()}`;
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { "cache-control": "no-cache" } });
      const html = response.ok ? await response.text() : "";
      results.push(websiteShowsCount(html, item.asin, item.pageCount));
    } catch { results.push(false); }
  }
  return results.every(Boolean);
}

/** Each private intent is written before any D1 mutation and survives restart. */
export async function queuePageCountSync(runId, audit, { write = putPrivateJson } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new TypeError("Invalid audit run ID.");
  const items = pageCountCandidates(audit);
  if (!items.length) return { queued: 0, key: null };
  const key = `${PREFIX}${runId}.json`;
  await write("kdp", key, { runId, status: "prepared", createdAt: new Date().toISOString(), items });
  return { queued: items.length, key };
}

export async function processPageCountIntent(key, intent, dependencies = {}) {
  const env = dependencies.env || process.env;
  const write = dependencies.write || putPrivateJson;
  const update = dependencies.update || updateKdpEbookPageCount;
  const readBook = dependencies.readBook || getKdpEbookById;
  const purge = dependencies.purge || purgeCloudflareCache;
  const validatePurge = dependencies.validatePurge || resolveCloudflarePurgeConfig;
  const rebuild = dependencies.rebuild || (() => triggerRebuild(env));
  const verify = dependencies.verify || verifyWebsite;
  const remove = dependencies.remove || deleteObject;
  const save = () => write("kdp", key, intent);
  if (!Array.isArray(intent.items) || !intent.items.length) throw new Error("Invalid page-count sync intent.");
  if (intent.status === "prepared") {
    // Do not change D1 until the website update prerequisites are configured.
    if (!configuredHooks(env).length) {
      intent.lastStatus = "waiting_for_website_hook";
      await save();
      return { status: intent.lastStatus };
    }
    try { validatePurge(env); } catch {
      intent.lastStatus = "waiting_for_cache_purge_config";
      await save();
      return { status: intent.lastStatus };
    }
    for (const item of intent.items) {
      if (["updated", "already_updated", "conflict"].includes(item.updateStatus)) continue;
      try {
        const result = await update(item);
        item.updateStatus = result.status;
      } catch (error) {
        item.updateStatus = error?.code === "kdp_ebook_not_found" ? "conflict" : "retry_pending";
      }
      // Persist each result so one failed item cannot erase completed work.
      await save();
    }
    delete intent.lastStatus;
    const hasApplied = intent.items.some((item) => ["updated", "already_updated"].includes(item.updateStatus));
    const hasRetry = intent.items.some((item) => item.updateStatus === "retry_pending");
    intent.status = hasApplied ? "pending_rebuild" : hasRetry ? "prepared" : "conflict";
    await save();
    if (!hasApplied) return { status: hasRetry ? "retry_pending" : "conflict" };
  }
  const applied = intent.items.filter((item) => ["updated", "already_updated"].includes(item.updateStatus));
  if (!applied.length) {
    intent.status = "conflict";
    await save();
    return { status: "conflict", conflicts: intent.items.length };
  }
  if (intent.status === "pending_rebuild") {
    await purge({ files: [API_URL] });
    const result = await rebuild();
    if (!result.ok) return { status: "rebuild_pending", updated: applied.length, reason: result.reason };
    intent.status = "rebuild_requested";
    intent.requestedAt = new Date().toISOString();
    await save();
  }
  if (intent.status === "rebuild_requested") {
    // If the catalogue has changed again, never verify stale values or retrigger them.
    const currentItems = [];
    for (const item of applied) {
      try {
        const current = await readBook(item.ebookId);
        if (current.asin.toUpperCase() === item.asin && current.pageCount === item.pageCount) currentItems.push(item);
        else item.updateStatus = "conflict";
      } catch (error) {
        if (error?.code !== "kdp_ebook_not_found") throw error;
        item.updateStatus = "conflict";
      }
    }
    if (!currentItems.length || await verify(currentItems)) {
      const outstanding = intent.items.filter((item) => ["retry_pending", "conflict"].includes(item.updateStatus));
      if (outstanding.length) {
        intent.items = outstanding;
        intent.status = outstanding.some((item) => item.updateStatus === "retry_pending") ? "prepared" : "conflict";
        await save();
        return { status: "verified_partial", updated: currentItems.length, outstanding: outstanding.length };
      }
      await remove("kdp", key);
      return { status: "verified", updated: currentItems.length };
    }
    if (Date.now() - Date.parse(intent.requestedAt || "") >= REBUILD_RETRY_MS) {
      intent.status = "pending_rebuild";
      await save();
    }
    return { status: "awaiting_website", updated: applied.length };
  }
  return { status: intent.status };
}

export async function reconcilePageCountSync() {
  if (running) return running;
  running = (async () => {
    const results = [];
    for (const object of await listObjects("kdp", PREFIX)) {
      try {
        const result = await processPageCountIntent(object.key, await loadIntent(object.key));
        results.push({ key: object.key, ...result });
      } catch (error) {
        log.warn("kdp.pageCountSync.pending", { key: object.key, error: String(error?.message || "sync failed").slice(0, 300) });
        results.push({ key: object.key, status: "retry_pending" });
      }
    }
    return results;
  })().finally(() => { running = undefined; });
  return running;
}

export async function listPageCountSync() {
  const objects = await listObjects("kdp", PREFIX);
  return Promise.all(objects.map(async ({ key }) => {
    const intent = await loadIntent(key);
    return { runId: intent.runId, status: intent.lastStatus || intent.status, createdAt: intent.createdAt, requestedAt: intent.requestedAt || null,
      books: intent.items?.length || 0 };
  }));
}

export function startPageCountSyncWorker() {
  if (timer) return;
  if (!process.env.D1_API_KEY || !configuredHooks(process.env).length) return;
  const run = () => { void reconcilePageCountSync().catch((error) => log.warn("kdp.pageCountSync.worker", { error: error?.message })); };
  timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  run();
}

export function stopPageCountSyncWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
