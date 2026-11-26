import express from "express";
import { startAsyncServiceRouteJob, getAsyncServiceRouteJobFresh } from "../../shared/utils/asyncServiceRouteJobs.js";
import { assessThreeBooks } from "../bookFeature/assessment.js";
import { effectiveMode } from "../bookFeature/core.js";
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

router.get("/book-feature/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "book_feature_outreach", mode: effectiveMode(process.env.BOOK_FEATURE_OUTREACH_MODE, "assessment"),
    dispatchEnabled: false, schedulerRegistered: false, pilotAuthorised: false });
});

router.post("/book-feature/assessment/three-books", asyncRoute(async (req, res) => {
  const mode = effectiveMode(process.env.BOOK_FEATURE_OUTREACH_MODE, "assessment");
  if (mode === "disabled" || mode === "suspended") return res.status(409).json({ ok: false, error: `Service mode is ${mode}.` });
  const seed = String(req.body?.seed || "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seed)) return res.status(400).json({ ok: false, error: "Provide a short reproducible alphanumeric seed." });
  const job = await startAsyncServiceRouteJob({ service: "book-feature", lane: "assessment", payload: { seed, sessionId: `three-books-${seed}` }, req,
    statusBasePath: "/outreach/book-feature/assessment/jobs", reuseTerminal: true,
    runner: async () => {
      const report = await assessThreeBooks(seed);
      return { ok: report.completeAnalyses === 3, partialFailure: report.completeAnalyses !== 3,
        reason: report.completeAnalyses === 3 ? null : "One or more selected manuscripts could not be fully analysed.",
        seed, selected: report.selection.selected, completeAnalyses: report.completeAnalyses,
        statuses: report.books.map(({ ebookId, status }) => ({ ebookId, status })), privateReportKey: report.privateReportKey, dispatched: 0 };
    } });
  res.status(202).json(job);
}));

router.get("/book-feature/assessment/jobs/:sessionId", asyncRoute(async (req, res) => {
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
