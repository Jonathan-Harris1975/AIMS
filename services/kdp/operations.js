import crypto from "node:crypto";
import express from "express";
import { requestDedupe } from "../shared/utils/requestDedupe.js";
import { getAsyncServiceRouteJobFresh, startAsyncServiceRouteJob } from "../shared/utils/asyncServiceRouteJobs.js";
import { fetchAccountInfo, fetchReportsCatalog } from "./engine/kdpAccount.ts";
import { analyzeBookMetadata } from "./engine/kdpAnalyze.ts";
import { analyzeKdpPriceFloors } from "./engine/kdpPriceRules.ts";
import { uploadBookContent } from "./engine/kdpContentUpdate.ts";
import { createTitle, publishBook, updateCategories } from "./engine/kdpPublish.ts";
import { archiveTitle, deleteTitle, unpublishTitle } from "./engine/kdpTitleActions.ts";
import { checkSession, downloadLifetimeRoyaltiesReport, downloadRoyaltiesReport, KdpAuthError, KdpClientError } from "./engine/kdpClient.ts";
import { listBookshelf, syncAllBookMetadata, syncBookMetadata } from "./engine/kdpMetadata.ts";
import { updateBookMetadata, updateBookMetadataBatch } from "./engine/kdpMetadataUpdate.ts";
import { updateBookPricing, updateBookPricingBatch } from "./engine/kdpPricingUpdate.ts";
import { ensureKdpLogin, getLoginState } from "./engine/login.ts";
import { readMetadataCache, removeMetadataCache, METADATA_CACHE_VERSION } from "./engine/metadataStore.ts";
import { readRecoveryLearnings } from "./engine/kdpRecoveryStore.ts";
import { readSessionMeta, removeSession } from "./engine/session.ts";
import { getKdpEbookByAsin, getKdpEbookById, listKdpEbooks } from "./catalogue.js";
import { auditPublicCatalogue } from "./publicListingAudit.js";
import { listPageCountSync, queuePageCountSync, reconcilePageCountSync } from "./pageCountSync.js";
import { readWeeklyResearchState, runResearchBatch } from "./researchWorker.js";
import { getKdpReadiness } from "./readiness.js";
import {
  downloadKdpObjectToTempFile,
  persistKdpAuditReport,
  persistKdpMetadata,
  persistKdpRoyaltyReport,
  readKdpAuditReport,
  readKdpMetadataSnapshot,
} from "./storage.js";

const router = express.Router();
const ASYNC_STATUS_BASE = "/kdp/jobs";

router.get("/research/weekly", async (req, res, next) => {
  try {
    const state = await readWeeklyResearchState();
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, state });
  } catch (error) { next(error); }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendError(res, error, fallback) {
  const status = Number(error?.statusCode) || (error instanceof KdpAuthError ? 401 : error instanceof KdpClientError ? 502 : 500);
  const message = status >= 500 ? fallback : String(error?.message || fallback);
  return res.status(status).json({ ok: false, error: message, code: error?.code || (error instanceof KdpAuthError ? "auth" : error instanceof KdpClientError ? "kdp" : "unknown") });
}

function requireObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("A JSON object body is required.");
    error.statusCode = 400;
    error.code = "validation";
    throw error;
  }
  return body;
}

function requiredString(value, name, max = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) {
    const error = new Error(`${name} is required and must be no longer than ${max} characters.`);
    error.statusCode = 400;
    error.code = "validation";
    throw error;
  }
  return text;
}

function parseFormat(value) {
  if (value === "kindle" || value === "paperback" || value === "hardcover") return value;
  const error = new Error("format must be kindle, paperback or hardcover.");
  error.statusCode = 400;
  error.code = "validation";
  throw error;
}

function parseMonth(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    const error = new Error(`${name} must use YYYY-MM format.`);
    error.statusCode = 400;
    error.code = "validation";
    throw error;
  }
  return text;
}

function categorySpecs(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    const error = new Error("categories must be a non-empty array.");
    error.statusCode = 400;
    error.code = "validation";
    throw error;
  }
  const result = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each category needs path[] or browseNodeId.");
    if (Array.isArray(item.path) && item.path.length && item.path.every((part) => typeof part === "string" && part.trim())) return { path: item.path.map((part) => part.trim()) };
    if (typeof item.browseNodeId === "string" && item.browseNodeId.trim()) return { browseNodeId: item.browseNodeId.trim() };
    throw new Error("Each category needs path[] or browseNodeId.");
  });
  return result;
}

function startJob(req, res, lane, runner, payload = {}) {
  return startAsyncServiceRouteJob({
    service: "kdp",
    lane,
    payload: { ...payload, ...(payload.sessionId ? {} : {}), sessionId: payload.sessionId || req.body?.sessionId || undefined },
    req,
    statusBasePath: ASYNC_STATUS_BASE,
    runner,
    metadata: { route: `/kdp/${lane}` },
  }).then((job) => res.status(202).json(job)).catch((error) => sendError(res, error, `Could not start KDP ${lane} job.`));
}

router.post("/research/weekly/run", asyncRoute(async (req, res) =>
  startJob(req, res, "weekly-research", () => runResearchBatch()),
));

async function persistSyncedMetadata(cache) {
  const snapshotRef = await persistKdpMetadata(cache);
  return { cache, snapshotRef };
}

async function loadMetadataSnapshot() {
  const local = await readMetadataCache();
  if (local?.books?.length) return local;
  return readKdpMetadataSnapshot();
}

function authorFromCatalogue(author) {
  const name = String(author || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: name.shift() || "", lastName: name.join(" ") };
}

async function preparePublishRequest(body) {
  const raw = requireObjectBody(body);
  const format = parseFormat(raw.format);
  const book = raw.ebookId === undefined ? null : await getKdpEbookById(raw.ebookId);
  const detailsOverride = raw.details && typeof raw.details === "object" && !Array.isArray(raw.details) ? raw.details : {};
  const details = book ? {
    title: book.title,
    description: book.description || book.summary,
    keywords: book.keywords.slice(0, 7),
    primaryAuthor: authorFromCatalogue(book.author),
    ...detailsOverride,
  } : detailsOverride;

  const request = {
    format,
    titleId: raw.titleId === undefined ? undefined : requiredString(raw.titleId, "titleId", 120),
    create: raw.create === true,
    dryRun: raw.dryRun !== false,
    publish: raw.publish === true,
    details: Object.keys(details).length ? details : undefined,
    categories: categorySpecs(raw.categories),
    pricing: raw.pricing && typeof raw.pricing === "object" && !Array.isArray(raw.pricing) ? raw.pricing : undefined,
    content: {},
  };
  const cleanup = [];

  try {
    if (book) {
      if (book.storageBucket !== "kdp" || book.manuscriptFormat !== "PDF") {
        const error = new Error("Catalogue manuscript must be a private PDF in the KDP R2 bucket.");
        error.statusCode = 422;
        error.code = "kdp_manuscript_reference_invalid";
        throw error;
      }
      const interior = await downloadKdpObjectToTempFile(book.manuscriptR2Key, {
        expectedPrefix: "Manuscripts pdf format/",
        suffix: ".pdf",
      });
      request.content.interiorPath = interior.filePath;
      cleanup.push(interior.cleanup);
    }

    if (raw.interiorR2Key) {
      const interior = await downloadKdpObjectToTempFile(raw.interiorR2Key, {
        expectedPrefix: "Manuscripts pdf format/",
        suffix: ".pdf",
      });
      request.content.interiorPath = interior.filePath;
      cleanup.push(interior.cleanup);
    }
    if (raw.coverR2Key) {
      const extension = String(raw.coverR2Key).match(/\.[a-z0-9]{2,5}$/i)?.[0] || ".pdf";
      const cover = await downloadKdpObjectToTempFile(raw.coverR2Key, { suffix: extension });
      request.content.coverPath = cover.filePath;
      cleanup.push(cover.cleanup);
    }

    if (!request.create && !request.titleId) {
      const error = new Error("Provide titleId for an existing listing or set create=true.");
      error.statusCode = 400;
      error.code = "validation";
      throw error;
    }
    if (request.publish && request.dryRun) {
      const error = new Error("Set dryRun=false before requesting a live publish.");
      error.statusCode = 400;
      error.code = "validation";
      throw error;
    }
    request._cleanup = cleanup;
    return request;
  } catch (error) {
    await Promise.all(cleanup.map((remove) => remove().catch(() => {})));
    throw error;
  }
}

async function withPreparedPublish(body, run) {
  const request = await preparePublishRequest(body);
  try {
    const result = await run(request);
    if (result?.titleId && body?.ebookId) {
      const record = {
        ebookId: Number(body.ebookId),
        titleId: result.titleId,
        format: request.format,
        published: Boolean(result.published),
        updatedAt: new Date().toISOString(),
      };
      const { putPrivateJson } = await import("../shared/utils/r2-client.js");
      await putPrivateJson("kdp", `publishing/${record.ebookId}/${record.format}/latest.json`, record);
    }
    return result;
  } finally {
    await Promise.all((request._cleanup || []).map((cleanup) => cleanup().catch(() => {})));
  }
}

async function withR2Content(raw, run) {
  const body = requireObjectBody(raw);
  const titleId = requiredString(body.titleId, "titleId", 120);
  const format = parseFormat(body.format);
  const fileType = body.fileType;
  if (fileType !== "interior" && fileType !== "cover") {
    const error = new Error("fileType must be interior or cover.");
    error.statusCode = 400;
    error.code = "validation";
    throw error;
  }
  let key = body.r2Key;
  if (fileType === "interior" && body.ebookId !== undefined) {
    const book = await getKdpEbookById(body.ebookId);
    if (book.storageBucket !== "kdp" || book.manuscriptFormat !== "PDF") throw new Error("Catalogue manuscript is not a KDP PDF object.");
    key = book.manuscriptR2Key;
  }
  key = requiredString(key, "r2Key", 1024);
  const suffix = String(key).match(/\.[a-z0-9]{2,5}$/i)?.[0] || ".pdf";
  const temp = await downloadKdpObjectToTempFile(key, {
    ...(fileType === "interior" ? { expectedPrefix: "Manuscripts pdf format/" } : {}),
    suffix,
  });
  try {
    return await run({ titleId, format, fileType, filePath: temp.filePath });
  } finally {
    await temp.cleanup();
  }
}

router.get("/jobs/:lane/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncServiceRouteJobFresh("kdp", req.params.lane, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, error: "KDP job not found." });
  return res.json(job);
}));

router.get("/readiness", (_req, res) => {
  const readiness = getKdpReadiness();
  return res.status(readiness.ready ? 200 : 503).json({ ok: readiness.ready, service: "KDP", subservices: ["KDP_publishing", "KDP_audit"], readiness });
});

router.post("/session/connect", requestDedupe("kdp:session-connect"), asyncRoute(async (req, res) => startJob(req, res, "session-connect", async () => {
  await ensureKdpLogin();
  const session = await checkSession();
  if (!session.connected) throw new KdpAuthError("KDP sign-in did not produce a usable Amazon session.");
  return { ok: true, connected: true, accountCreationDate: session.accountCreationDate || null, sessionSavedAt: (await readSessionMeta()).savedAt };
})));

router.get("/session/status", asyncRoute(async (_req, res) => {
  const session = await checkSession();
  return res.json({ ok: true, connected: session.connected, accountCreationDate: session.accountCreationDate || null, sessionSavedAt: (await readSessionMeta()).savedAt, login: getLoginState() });
}));

router.delete("/session", requestDedupe("kdp:session-disconnect"), asyncRoute(async (_req, res) => {
  await removeSession();
  await removeMetadataCache();
  return res.json({ ok: true, disconnected: true, localMetadataCacheRemoved: true });
}));

router.get("/audit/metadata", asyncRoute(async (_req, res) => {
  const cache = await loadMetadataSnapshot();
  if (!cache) return res.status(404).json({ ok: false, error: "No KDP metadata snapshot. Start an audit sync first." });
  return res.json({
    ok: true,
    syncedAt: cache.syncedAt || null,
    cacheVersion: cache.cacheVersion || METADATA_CACHE_VERSION,
    stats: cache.stats || null,
    count: cache.books?.length || 0,
    books: cache.books || [],
  });
}));

router.get("/audit/metadata/analyze", asyncRoute(async (_req, res) => {
  const cache = await loadMetadataSnapshot();
  if (!cache?.books?.length) return res.status(404).json({ ok: false, error: "No KDP metadata snapshot. Start an audit sync first." });
  return res.json({ ok: true, syncedAt: cache.syncedAt || null, ...analyzeBookMetadata(cache.books) });
}));

router.get("/audit/recovery/learnings", asyncRoute(async (_req, res) => {
  return res.json({ ok: true, learnings: await readRecoveryLearnings() });
}));

router.get("/audit/reports/latest", asyncRoute(async (_req, res) => {
  const { getObjectAsText } = await import("../shared/utils/r2-client.js");
  try {
    const latest = JSON.parse(await getObjectAsText("kdp", "audit/reports/latest.json"));
    const date = String(latest.createdAt || "").slice(0, 10);
    const runId = String(latest.runId || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(runId)) {
      return res.status(404).json({ ok: false, error: "The latest KDP audit report reference is invalid." });
    }
    const report = await readKdpAuditReport(`audit/reports/${date}/${runId}.json`);
    return res.json({ ok: true, report });
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return res.status(404).json({ ok: false, error: "No KDP audit report is available." });
    throw error;
  }
}));

router.get("/audit/reports/:date/:runId", asyncRoute(async (req, res) => {
  const date = String(req.params.date || "");
  const runId = String(req.params.runId || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(runId)) return res.status(400).json({ ok: false, error: "Invalid audit report reference." });
  return res.json({ ok: true, report: await readKdpAuditReport(`audit/reports/${date}/${runId}.json`) });
}));

router.post("/audit/session/account", requestDedupe("kdp:audit-account"), asyncRoute(async (req, res) =>
  startJob(req, res, "audit-account", async () => ({ ok: true, account: await fetchAccountInfo() }))));
router.post("/audit/session/catalog", requestDedupe("kdp:audit-catalog"), asyncRoute(async (req, res) =>
  startJob(req, res, "audit-catalog", async () => ({ ok: true, books: await fetchReportsCatalog() }))));
router.post("/audit/session/bookshelf", requestDedupe("kdp:audit-bookshelf"), asyncRoute(async (req, res) =>
  startJob(req, res, "audit-bookshelf", async () => ({ ok: true, books: await listBookshelf() }))));

router.post("/audit/metadata/sync", requestDedupe("kdp:metadata-sync"), asyncRoute(async (req, res) => startJob(req, res, "audit-metadata-sync", async () => {
  const cache = await syncAllBookMetadata();
  const snapshotRef = await persistKdpMetadata(cache);
  return { ok: true, syncedAt: cache.syncedAt, count: cache.books.length, stats: cache.stats || null, snapshotRef };
})));

router.post("/audit/metadata/sync/:titleId/:format", requestDedupe("kdp:metadata-sync-single"), asyncRoute(async (req, res) => startJob(req, res, "audit-metadata-sync-single", async () => {
  const titleId = requiredString(req.params.titleId, "titleId", 120);
  const format = parseFormat(req.params.format);
  const book = await syncBookMetadata(titleId, format);
  const cache = await readMetadataCache();
  const snapshotRef = cache ? await persistKdpMetadata(cache) : null;
  return { ok: true, book, snapshotRef };
})));

function auditCatalogueContext(metadataBooks, catalogueBooks) {
  const byAsin = new Map(catalogueBooks.filter((book) => book.asin).map((book) => [book.asin.toLowerCase(), book]));
  const rows = metadataBooks.map((book) => {
    const catalogueBook = book.asin ? byAsin.get(String(book.asin).toLowerCase()) : null;
    return {
      titleId: book.titleId,
      format: book.format,
      asin: book.asin || null,
      catalogueMatch: catalogueBook ? {
        ebookId: catalogueBook.ebookId,
        slug: catalogueBook.slug,
        title: catalogueBook.title,
        author: catalogueBook.author,
        keywords: catalogueBook.keywords,
        manuscriptAvailable: Boolean(catalogueBook.manuscriptR2Key),
      } : null,
      listing: {
        title: book.title,
        description: book.description,
        keywords: book.keywords,
        categories: book.categories,
        publishingStatus: book.publishingStatus,
        listPriceUsd: book.listPriceUsd,
        prices: book.prices,
      },
    };
  });
  return {
    catalogueBooks: catalogueBooks.length,
    matchedListings: rows.filter((row) => row.catalogueMatch).length,
    unmatchedListings: rows.filter((row) => !row.catalogueMatch).length,
    listings: rows,
  };
}

router.post("/audit/run", requestDedupe("kdp:audit-run"), asyncRoute(async (req, res) => {
  const mode = req.body?.mode || "public";
  const marketplace = req.body?.marketplace || "US";
  if (!["public", "kdp"].includes(mode) || !["US", "UK"].includes(marketplace)) {
    return res.status(400).json({ ok: false, code: "validation", error: "mode must be public or kdp and marketplace must be US or UK." });
  }
  return startJob(req, res, "audit-run", async () => {
    const runId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    if (mode === "public") {
      const catalogue = await listKdpEbooks();
      const publicAudit = await auditPublicCatalogue(catalogue, { marketplace });
      // A failed intent write must fail the job: no durable retry exists yet.
      const queued = await queuePageCountSync(runId, publicAudit);
      let pageCountSync = { queued: queued.queued, status: queued.key ? "retry_pending" : "no_changes" };
      try {
        const pending = await reconcilePageCountSync();
        const current = pending.find((entry) => entry.key === queued.key);
        pageCountSync = { ...pageCountSync, ...(current || {}), pending };
      } catch {
        pageCountSync = { ...pageCountSync, status: "retry_pending" };
      }
      const report = {
        ok: true, service: "KDP_audit", mode, runId, createdAt,
        completedAt: new Date().toISOString(), publicAudit, pageCountSync,
        complete: publicAudit.catalogueBooks > 0 && publicAudit.notCaptured === 0,
        changesApplied: pageCountSync.updated > 0 ? true : pageCountSync.status === "retry_pending" ? null : false,
        message: "Verified Kindle page-count differences are reconciled to D1 and followed by a website rebuild. No KDP listings are changed.",
      };
      const reportRef = await persistKdpAuditReport(report);
      const { putPrivateJson } = await import("../shared/utils/r2-client.js");
      await putPrivateJson("kdp", "audit/reports/latest.json", { runId, createdAt, reportRef });
      return { ok: true, service: "KDP_audit", mode, runId, createdAt, complete: report.complete,
        bookCount: publicAudit.catalogueBooks, captured: publicAudit.captured, notCaptured: publicAudit.notCaptured,
        statusCounts: publicAudit.statusCounts, pageCountSync, reportRef };
    }
    const cache = await syncAllBookMetadata();
    const snapshotRef = await persistKdpMetadata(cache);
    const [catalogue, account] = await Promise.all([listKdpEbooks(), fetchAccountInfo()]);
    const metadataAnalysis = analyzeBookMetadata(cache.books);
    const priceFloorAnalysis = analyzeKdpPriceFloors(cache.books);
    const report = {
      ok: true,
      service: "KDP_audit",
      mode,
      runId,
      createdAt,
      syncedAt: cache.syncedAt,
      account: { accountCreationDate: account.accountCreationDate, catalogSize: account.catalogSize },
      metadataAnalysis,
      priceFloorAnalysis,
      catalogueComparison: auditCatalogueContext(cache.books, catalogue),
      syncStats: cache.stats || null,
      metadataSnapshotRef: snapshotRef,
      changesApplied: false,
      message: "Audit is read-only. Price-band issues include per-market 70% royalty limits; listing updates use separate pricing and metadata routes.",
    };
    const reportRef = await persistKdpAuditReport(report);
    const { putPrivateJson } = await import("../shared/utils/r2-client.js");
    await putPrivateJson("kdp", "audit/reports/latest.json", { runId, createdAt, reportRef });
    return {
      ok: true,
      service: "KDP_audit",
      runId,
      createdAt,
      syncedAt: cache.syncedAt,
      bookCount: cache.books.length,
      issueCount: metadataAnalysis.issueCount + priceFloorAnalysis.issueCount,
      metadataIssueCount: metadataAnalysis.issueCount,
      priceFloorIssueCount: priceFloorAnalysis.issueCount,
      catalogue: {
        books: report.catalogueComparison.catalogueBooks,
        matchedListings: report.catalogueComparison.matchedListings,
        unmatchedListings: report.catalogueComparison.unmatchedListings,
      },
      reportRef,
      metadataSnapshotRef: snapshotRef,
    };
  });
}));

router.get("/audit/page-count-sync", asyncRoute(async (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ ok: true, pending: await listPageCountSync() });
}));

router.post("/audit/page-count-sync/retry", requestDedupe("kdp:page-count-sync"), asyncRoute(async (req, res) =>
  startJob(req, res, "page-count-sync", async () => ({ ok: true, results: await reconcilePageCountSync() }))));

router.post("/audit/reports/download", requestDedupe("kdp:royalty-report"), asyncRoute(async (req, res) => startJob(req, res, "audit-royalty-report", async () => {
  const raw = requireObjectBody(req.body);
  const startMonth = parseMonth(raw.startMonth, "startMonth");
  const endMonth = parseMonth(raw.endMonth, "endMonth");
  const result = startMonth || endMonth ? await downloadRoyaltiesReport({ startMonth, endMonth }) : await downloadLifetimeRoyaltiesReport();
  const filename = `kdp-royalties-${result.startDate.slice(0, 10)}_${result.endDate.slice(0, 10)}.xlsx`;
  const reportRef = await persistKdpRoyaltyReport(filename, result.buffer, {
    startDate: result.startDate,
    endDate: result.endDate,
    monthsDownloaded: result.monthsDownloaded,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, reportRef, startDate: result.startDate, endDate: result.endDate, monthsDownloaded: result.monthsDownloaded };
})));

router.post("/audit/metadata/update", requestDedupe("kdp:metadata-update"), asyncRoute(async (req, res) => startJob(req, res, "audit-metadata-update", async () => {
  const body = requireObjectBody(req.body);
  const result = await updateBookMetadata(requiredString(body.titleId, "titleId", 120), parseFormat(body.format), body.changes, { dryRun: body.dryRun !== false });
  return { ok: true, ...result };
})));

router.post("/audit/metadata/update/batch", requestDedupe("kdp:metadata-update-batch"), asyncRoute(async (req, res) => startJob(req, res, "audit-metadata-update-batch", async () => {
  const body = requireObjectBody(req.body);
  if (!Array.isArray(body.updates) || !body.updates.length) throw Object.assign(new Error("updates array is required."), { statusCode: 400, code: "validation" });
  const updates = body.updates.map((item) => ({ titleId: requiredString(item?.titleId, "titleId", 120), format: parseFormat(item?.format), changes: item?.changes }));
  // Amazon KDP changes are always processed sequentially to prevent parallel browser writes.
  return { ok: true, ...(await updateBookMetadataBatch(updates, { dryRun: body.dryRun !== false })) };
})));

router.post("/audit/pricing/update", requestDedupe("kdp:pricing-update"), asyncRoute(async (req, res) => startJob(req, res, "audit-pricing-update", async () => {
  const body = requireObjectBody(req.body);
  return { ok: true, ...(await updateBookPricing(requiredString(body.titleId, "titleId", 120), parseFormat(body.format), body.changes, { dryRun: body.dryRun !== false })) };
})));

router.post("/audit/pricing/update/batch", requestDedupe("kdp:pricing-update-batch"), asyncRoute(async (req, res) => startJob(req, res, "audit-pricing-update-batch", async () => {
  const body = requireObjectBody(req.body);
  if (!Array.isArray(body.updates) || !body.updates.length) throw Object.assign(new Error("updates array is required."), { statusCode: 400, code: "validation" });
  const updates = body.updates.map((item) => ({ titleId: requiredString(item?.titleId, "titleId", 120), format: parseFormat(item?.format), changes: item?.changes }));
  return { ok: true, ...(await updateBookPricingBatch(updates, { dryRun: body.dryRun !== false })) };
})));

router.post("/publishing/content/upload", requestDedupe("kdp:content-upload"), asyncRoute(async (req, res) =>
  startJob(req, res, "publishing-content-upload", async () => withR2Content(req.body, (content) =>
    uploadBookContent(content.titleId, content.format, content.fileType, content.filePath, { dryRun: req.body?.dryRun !== false })))));

router.post("/publishing/content/upload/batch", requestDedupe("kdp:content-upload-batch"), asyncRoute(async (req, res) => startJob(req, res, "publishing-content-upload-batch", async () => {
  const body = requireObjectBody(req.body);
  if (!Array.isArray(body.uploads) || !body.uploads.length) throw Object.assign(new Error("uploads array is required."), { statusCode: 400, code: "validation" });
  const results = [];
  for (const item of body.uploads) {
    const result = await withR2Content(item, (content) => uploadBookContent(
      content.titleId,
      content.format,
      content.fileType,
      content.filePath,
      { dryRun: body.dryRun !== false },
    ));
    results.push(result);
  }
  return { ok: true, results, succeeded: results.filter((result) => result?.uploaded).length, failed: results.filter((result) => !result?.uploaded).length };
})));

router.post("/publishing/titles/create", requestDedupe("kdp:title-create"), asyncRoute(async (req, res) =>
  startJob(req, res, "publishing-title-create", async () => ({
    ok: true,
    ...(await createTitle(parseFormat(requireObjectBody(req.body).format))),
  }))));

router.post("/publishing/categories/update", requestDedupe("kdp:categories-update"), asyncRoute(async (req, res) => startJob(req, res, "publishing-categories-update", async () => {
  const body = requireObjectBody(req.body);
  return {
    ok: true,
    ...(await updateCategories(
      requiredString(body.titleId, "titleId", 120),
      parseFormat(body.format),
      categorySpecs(body.categories),
      { isAdultContent: body.isAdultContent === true, language: typeof body.language === "string" ? body.language : "English" },
    )),
  };
})));

router.post("/publishing/publish", requestDedupe("kdp:publish"), asyncRoute(async (req, res) => {
  const body = requireObjectBody(req.body);
  if (body.publish === true && !req.idempotencyKey) return res.status(400).json({ ok: false, error: "A live publish request requires X-Idempotency-Key.", code: "idempotency_key_required" });
  return startJob(req, res, "publishing-publish", async () => withPreparedPublish(body, (request) => publishBook(request)));
}));

for (const [action, run] of [
  ["unpublish", unpublishTitle],
  ["delete", deleteTitle],
  ["archive", archiveTitle],
]) {
  router.post(`/publishing/titles/${action}`, requestDedupe(`kdp:title-${action}`), asyncRoute(async (req, res) => startJob(req, res, `publishing-title-${action}`, async () => {
    const body = requireObjectBody(req.body);
    if (body.confirm !== true) throw Object.assign(new Error(`Set confirm=true to ${action} a KDP title.`), { statusCode: 400, code: "confirmation_required" });
    const titleId = requiredString(body.titleId, "titleId", 120);
    const format = parseFormat(body.format);
    return { ok: true, ...(await run(titleId, format)) };
  })));
}

router.post("/publishing/metadata/sync/:titleId/:format", requestDedupe("kdp:publishing-metadata-sync"), asyncRoute(async (req, res) =>
  startJob(req, res, "publishing-metadata-sync", async () => ({
    ok: true,
    book: await syncBookMetadata(
      requiredString(req.params.titleId, "titleId", 120),
      parseFormat(req.params.format),
    ),
  }))));

router.get("/health", (_req, res) => res.json({ ok: true, service: "KDP", time: new Date().toISOString() }));

export default router;
