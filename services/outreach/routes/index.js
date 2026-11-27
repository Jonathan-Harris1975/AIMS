import express from "express";
import { rateLimit } from "express-rate-limit";
import { startAsyncServiceRouteJob, getAsyncServiceRouteJobFresh } from "../../shared/utils/asyncServiceRouteJobs.js";
import { assessThreeBooks } from "../bookFeature/assessment.js";
import { scheduledLondonOccurrence } from "../bookFeature/core.js";
import { runBookFeatureAssessment } from "../bookFeature/run.js";
import { BookFeatureRepository } from "../bookFeature/repository.js";
import { BookFeatureDispatchWorker } from "../bookFeature/dispatchWorker.js";
import { ControlledGuestOutbox } from "../services/controlledGuestOutbox.js";
import { handleBookFeatureInbound, verifyInboundSignature } from "../bookFeature/inboundLifecycle.js";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress } from "../services/batchService.js";
import { getRequestIdempotencyKey, requestDedupe } from "../../shared/utils/requestDedupe.js";
import {
  validateBody,
  outreachKeywordBodySchema,
  outreachResetBodySchema,
} from "../../shared/utils/requestSchemas.js";

const router = express.Router();
const outreachWebhookRateLimit = rateLimit({ windowMs: 60_000, limit: 60, legacyHeaders: false,
  standardHeaders: "draft-8", passOnStoreError: false, message: { ok: false, error: "Rate limit exceeded" } });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const operatorActor = (req) => String(req.get("x-comms-hub-actor") || "authenticated_suite_operator").slice(0, 200);
const requireAdminMutation = (req, res) => {
  const delegatedRole = String(req.get("x-comms-hub-role") || "").toLowerCase();
  if (delegatedRole && delegatedRole !== "admin") {
    res.status(403).json({ ok: false, error: "Administrator role is required for Outreach control changes." });
    return false;
  }
  return true;
};
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
    killSwitch: mode.killSwitch, testRecipientsConfigured: mode.testRecipients.length, perRunCap: mode.perRunCap,
    dailyCap: mode.dailyCap, dispatchEnabled: mode.effective === "controlled_test" && !mode.killSwitch,
    schedulerOwner: "MAST", pilotAuthorised: mode.effective === "pilot" });
}));

router.get("/book-feature/overview", asyncRoute(async (_req, res) => {
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const overview = await repository.overview();
  overview.guestArticleControlled = await new ControlledGuestOutbox(repository.d1).overview();
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "book_feature_outreach", ...overview });
}));

router.put("/book-feature/mode", asyncRoute(async (req, res) => {
  if (!requireAdminMutation(req, res)) return;
  const next = req.body?.mode;
  const version = req.body?.expectedVersion;
  const reason = String(req.body?.reason || "").trim();
  if (!["disabled", "assessment", "suspended"].includes(next) || !reason ||
      !Number.isSafeInteger(version) || version < 1) {
    return res.status(400).json({ ok: false, error: "Safe mode, reason and expectedVersion are required." });
  }
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const mode = await repository.transitionMode(next, operatorActor(req), version, reason);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, mode });
}));

router.put("/book-feature/controlled-test", asyncRoute(async (req, res) => {
  if (!requireAdminMutation(req, res)) return;
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const mode = await repository.configureControlledTest({ recipients: req.body?.recipients,
    perRunCap: req.body?.perRunCap, dailyCap: req.body?.dailyCap,
    reason: req.body?.reason, expectedVersion: req.body?.expectedVersion,
    actor: operatorActor(req) });
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, mode });
}));

router.post("/book-feature/dispatch/once", asyncRoute(async (req, res) => {
  if (!requireAdminMutation(req, res)) return;
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const { getCommsHubContext } = await import("../../comms-hub/runtime.js");
  const context = getCommsHubContext();
  let result = await new BookFeatureDispatchWorker({ repository, context }).runOnce();
  if (!result.processed) result = await new ControlledGuestOutbox(context.d1).runOnce(context);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...result });
}));

router.post("/book-feature/delivery/:outboxId/reconcile", asyncRoute(async (req, res) => {
  if (!requireAdminMutation(req, res)) return;
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const result = await repository.reconcileOutbox({ outboxId: req.params.outboxId, outcome: req.body?.outcome,
    providerEventId: req.body?.providerEventId, providerMessageId: req.body?.providerMessageId || null,
    evidence: req.body?.evidence || {}, actor: operatorActor(req) });
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...result });
}));

router.post("/book-feature/delivery/event", outreachWebhookRateLimit, asyncRoute(async (req, res) => {
  const rawBody = req.aimsRawBody?.toString("utf8");
  if (!rawBody || !verifyInboundSignature(rawBody, { signature: req.get("x-aims-outreach-signature"),
    timestamp: req.get("x-aims-outreach-timestamp"), secret: process.env.BOOK_FEATURE_INBOUND_WEBHOOK_SECRET })) {
    return res.status(401).json({ ok: false, error: "Provider event authentication failed." });
  }
  const event = JSON.parse(rawBody);
  if (!event.providerEventId || !event.providerMessageId || !event.outboxId || !["delivered","bounced","failed"].includes(event.outcome)) {
    return res.status(400).json({ ok: false, error: "Matching provider delivery evidence is required." });
  }
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  if (event.campaign === "guest_article") {
    const result = await new ControlledGuestOutbox(repository.d1).reconcile({ outboxId: event.outboxId,
      eventId: event.providerEventId, providerMessageId: event.providerMessageId, outcome: event.outcome });
    return res.status(202).json({ ok: true, ...result });
  }
  const result = await repository.reconcileOutbox({ outboxId: event.outboxId, outcome: event.outcome,
    providerEventId: event.providerEventId, providerMessageId: event.providerMessageId,
    evidence: { authenticatedRelay: true }, actor: "authenticated_provider_relay", authenticatedProvider: true });
  res.status(202).json({ ok: true, ...result });
}));

router.post("/book-feature/inbound", outreachWebhookRateLimit, asyncRoute(async (req, res) => {
  const repository = await bookFeatureRepository(res);
  if (!repository) return;
  const rawBody = req.aimsRawBody?.toString("utf8");
  if (!rawBody) return res.status(400).json({ ok: false, error: "Original signed payload is required." });
  const result = await handleBookFeatureInbound({ rawBody,
    signature: req.get("x-aims-outreach-signature"), timestamp: req.get("x-aims-outreach-timestamp"),
    secret: process.env.BOOK_FEATURE_INBOUND_WEBHOOK_SECRET,
    providerEventId: req.body?.providerEventId, providerMessageId: req.body?.providerMessageId,
    contactId: req.body?.contactId, text: req.body?.text, occurredAt: req.body?.occurredAt }, { repository });
  res.status(202).json({ ok: true, ...result });
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

router.post("/batch/next", asyncRoute(async (req, res) => {
  const result = await runNextBatch({ triggerRunKey: getRequestIdempotencyKey(req) || "" });
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
