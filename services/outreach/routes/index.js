import express from "express";
import { startAsyncServiceRouteJob, getAsyncServiceRouteJobFresh } from "../../shared/utils/asyncServiceRouteJobs.js";
import { assessThreeBooks } from "../bookFeature/assessment.js";
import { scheduledLondonOccurrence } from "../bookFeature/core.js";
import { runBookFeatureAssessment } from "../bookFeature/run.js";
import { BookFeatureRepository } from "../bookFeature/repository.js";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress } from "../services/batchService.js";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
import {
  validateBody,
  outreachKeywordBodySchema,
  outreachResetBodySchema,
} from "../../shared/utils/requestSchemas.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bookFeatureRepository = async (res) => {
  const { getCommsHubContext } = await import("../../comms-hub/runtime.js");
  const d1 = getCommsHubContext()?.d1;
  if (!d1) {
    res.status(503).json({ ok: false, error: "Book Feature D1 binding is unavailable." });
    return null;
  }
  return new BookFeatureRepository(d1);
};

router.get("/book-feature/status", asyncRoute(async (_req, res) => {
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const mode = await repository.mode();
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "book_feature_outreach", mode: mode.effective, configurationVersion: mode.version,
    dispatchEnabled: false, schedulerOwner: "MAST", pilotAuthorised: false });
}));

router.get("/book-feature/overview", asyncRoute(async (_req, res) => {
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const overview = await repository.overview();
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "book_feature_outreach", ...overview });
}));

router.put("/book-feature/mode", asyncRoute(async (req, res) => {
  const next = req.body?.mode;
  const version = req.body?.expectedVersion;
  if (!["disabled", "assessment", "shadow", "suspended"].includes(next) ||
      !Number.isSafeInteger(version) || version < 1) {
    return res.status(400).json({ ok: false, error: "Safe mode and expectedVersion are required." });
  }
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const mode = await repository.transitionMode(next, "authenticated_suite_operator", version);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, mode });
}));

router.post("/book-feature/run", asyncRoute(async (req, res) => {
  const now = new Date();
  const occurrence = scheduledLondonOccurrence(now);
  if (!occurrence) return res.status(409).json({ ok: false, error: "Outside Book Feature assessment window." });
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const job = await startAsyncServiceRouteJob({ service: "book-feature", lane: "run", req,
    payload: { sessionId: occurrence.id },
    statusBasePath: "/outreach/book-feature/jobs", reuseTerminal: true,
    runner: () => runBookFeatureAssessment({ now, repository }) });
  res.status(202).json(job);
}));

router.get("/book-feature/jobs/run/:sessionId", asyncRoute(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const job = await getAsyncServiceRouteJobFresh("book-feature", "run", req.params.sessionId, req);
  res.status(job ? 200 : 404).json(job || { ok: false, error: "Scheduled assessment job not found." });
}));

router.post("/book-feature/assessment/three-books", asyncRoute(async (req, res) => {
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const { effective: mode } = await repository.mode();
  if (mode === "disabled" || mode === "suspended") return res.status(409).json({ ok: false, error: `Service mode is ${mode}.` });
  const seed = String(req.body?.seed || "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seed)) return res.status(400).json({ ok: false, error: "Provide a short reproducible alphanumeric seed." });
  const job = await startAsyncServiceRouteJob({ service: "book-feature", lane: "assessment", payload: { seed, sessionId: `three-books-${seed}` }, req,
    statusBasePath: "/outreach/book-feature/jobs", reuseTerminal: true,
    runner: async () => {
      const report = await assessThreeBooks(seed);
      return { ok: report.completeAnalyses === 3, partialFailure: report.completeAnalyses !== 3,
        reason: report.completeAnalyses === 3 ? null : "One or more selected manuscripts could not be fully analysed.",
        seed, selected: report.selection.selected, completeAnalyses: report.completeAnalyses,
        statuses: report.books.map(({ ebookId, status }) => ({ ebookId, status })), dispatched: 0 };
    } });
  res.status(202).json(job);
}));

router.get("/book-feature/jobs/assessment/:sessionId", asyncRoute(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const job = await getAsyncServiceRouteJobFresh("book-feature", "assessment", req.params.sessionId, req);
  res.status(job ? 200 : 404).json(job || { ok: false, error: "Assessment job not found." });
}));

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "outreach" });
});

router.get("/automation/status", asyncRoute(async (_req, res) => {
  const { getCommsHubContext } = await import("../../comms-hub/runtime.js");
  const status = await getCommsHubContext().outreachAutomationService.status();
  res.json({ ok: true, service: "outreach", automation: status });
}));

router.post("/keyword", requestDedupe("outreach:keyword"), asyncRoute(async (req, res) => {
  const parsed = validateBody(outreachKeywordBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await runKeyword(parsed.data.keyword);
  res.json({ ok: true, ...result });
}));

router.post("/batch/next", requestDedupe("outreach:batchNext"), asyncRoute(async (req, res) => {
  const result = await runNextBatch({ triggerRunKey: req.idempotencyKey || "" });
  res.json({ ok: true, ...result });
}));

router.post("/batch/reset", requestDedupe("outreach:batchReset"), asyncRoute(async (req, res) => {
  const parsed = validateBody(outreachResetBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await resetProgress(parsed.data.lastProcessedIndex || 0);
  res.json({ ok: true, progress: result });
}));

export default router;
