import express from "express";
import { log } from "../../../logger.js";
import { recordProviderOutcome } from "../../shared/utils/operationalExcellence.js";
import { getProviderDiagnosticsForRoute } from "../../shared/utils/ai-service.js";
import { booleanValue, getCommsHubReadiness, loadCommsHubConfig } from "../config.js";
import { newCorrelationId, stableId } from "../domain/ids.js";
import { normalisePriorityOverride } from "../domain/ai.js";
import { readJotformWebhookEnvelope } from "../domain/webhook.js";
import { readZernioWebhookEnvelope } from "../domain/zernioWebhook.js";
import { safeErrorLog } from "../domain/redaction.js";
import { CommsHubError, toCommsHubError } from "../errors.js";
import {
  getCommsHubContext,
  getCommsHubRuntimeReadiness,
  kickCommsHubArchiveDrain,
  kickCommsHubSocialPoll,
} from "../runtime.js";
import { processJotformIntake } from "../intakeService.js";
import { executeSocialAction, requestSocialActionApproval } from "../socialActionsService.js";
import { decideApproval } from "../approvalService.js";
import { sendReplyDraft } from "../replyDraftService.js";
import { processZernioWebhook, reconcileZernioWebhook, withZernioAcceptanceDeadline } from "../socialService.js";

function publicError(error) {
  const normalised = toCommsHubError(error, {
    statusCode: 500,
    code: "comms_hub_internal_error",
    publicMessage: "Comms Hub could not process the request.",
  });
  return {
    statusCode: normalised.statusCode >= 400 && normalised.statusCode <= 599 ? normalised.statusCode : 500,
    body: {
      ok: false,
      error: normalised.code,
      message: normalised.publicMessage || (normalised.statusCode < 500 ? normalised.message : "Comms Hub could not process the request."),
    },
    normalised,
  };
}

function validConversationId(value) {
  const candidate = String(value || "").trim();
  return /^cnv_[0-9a-hjkmnp-tv-z]{26}$/.test(candidate) ? candidate : "";
}

function authenticatedActor(req) {
  return String(
    req?.user?.email
      || req?.user?.id
      || req?.aimsAuth?.subject
      || req?.aimsAuth?.strategy
      || "authenticated-aims-user"
  ).trim().slice(0, 200);
}

function boundedId(value, prefix) {
  const candidate = String(value || "").trim();
  const pattern = new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`);
  return pattern.test(candidate) ? candidate : "";
}

function requireReady(runtimeReadinessProvider) {
  const runtime = runtimeReadinessProvider();
  if (!runtime.ready) {
    throw new CommsHubError(503, "comms_hub_not_ready", `Comms Hub runtime is not ready: ${runtime.status || "unknown"}.`, {
      retryable: true,
      failureClass: "temporary",
      publicMessage: "Comms Hub is not ready.",
    });
  }
  return runtime;
}

export function createCommsHubRouter({
  contextProvider = getCommsHubContext,
  kickArchive = kickCommsHubArchiveDrain,
  kickSocialPoll = kickCommsHubSocialPoll,
  runtimeReadinessProvider = getCommsHubRuntimeReadiness,
} = {}) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    const configuration = getCommsHubReadiness();
    const runtime = runtimeReadinessProvider();
    const ready = configuration.ready && runtime.ready;
    const aiEnabled = booleanValue(process.env.COMMS_HUB_AI_ENABLED, false);
    return res.status(ready ? 200 : 503).json({
      ok: ready,
      service: "comms-hub",
      configuration: {
        enabled: configuration.enabled,
        status: configuration.status,
        forms: configuration.forms,
        zernio: Object.fromEntries(Object.entries(configuration.zernio).map(([family, state]) => [family, {
          enabled: state.enabled,
          status: state.status,
          platforms: state.platforms,
        }])),
      },
      runtime: {
        status: runtime.status,
        ready: runtime.ready,
        detail: runtime.detail,
        workers: runtime.workers || null,
      },
      channels: {
        jotform: ["contact", "case_study", "podcast_enquiry"],
        zernio: {
          meta: ["facebook", "instagram"],
          video: ["youtube"],
        },
        emailHost: "one.com",
      },
      capabilities: {
        ai: configuration.enabled && aiEnabled,
        approvals: aiEnabled ? true : booleanValue(process.env.COMMS_HUB_APPROVALS_ENFORCED, true),
        backups: booleanValue(process.env.COMMS_HUB_BACKUP_ENABLED, false),
      },
    });
  });

  router.post("/intake/jotform", async (req, res) => {
    const startedAt = Date.now();
    const correlationId = String(req.id || req.get?.("x-request-id") || newCorrelationId());
    let identifiers = null;
    try {
      const config = loadCommsHubConfig(process.env, { requireEnabled: true });
      requireReady(runtimeReadinessProvider);
      const envelope = await readJotformWebhookEnvelope(req, config.maxWebhookBytes);
      const active = contextProvider();
      const processed = await processJotformIntake({ envelope, correlationId, context: active });
      identifiers = processed.identifiers;
      const intake = processed.intake;
      const result = processed.persistence;
      kickArchive();
      recordProviderOutcome({
        routeKey: "comms-hub:jotform-intake",
        provider: "jotform",
        ok: true,
        durationMs: Date.now() - startedAt,
        status: result.duplicate ? "duplicate" : "accepted",
      });
      log.info("commsHub.intake.accepted", {
        correlationId,
        eventId: intake.eventId,
        conversationId: intake.conversationId,
        workflow: intake.route.workflow,
        duplicate: result.duplicate,
        attachmentCount: intake.attachments.length,
      });
      return res.status(result.duplicate ? 200 : 202).json({
        ok: true,
        accepted: true,
        duplicate: result.duplicate,
        correlationId,
      });
    } catch (error) {
      const output = publicError(error);
      recordProviderOutcome({
        routeKey: "comms-hub:jotform-intake",
        provider: "jotform",
        ok: false,
        durationMs: Date.now() - startedAt,
        status: output.normalised.code,
      });
      log[output.statusCode >= 500 ? "error" : "warn"]("commsHub.intake.rejected", {
        correlationId,
        formId: identifiers?.formId || null,
        submissionIdHashPresent: Boolean(identifiers?.submissionId),
        error: safeErrorLog(output.normalised),
      });
      return res.status(output.statusCode).json({ ...output.body, correlationId });
    }
  });

  router.post("/intake/zernio/:family", async (req, res) => {
    const startedAt = Date.now();
    const family = String(req.params.family || "").trim().toLowerCase();
    const correlationId = String(req.id || req.get?.("x-request-id") || newCorrelationId());
    try {
      const config = loadCommsHubConfig(process.env, { requireEnabled: true });
      requireReady(runtimeReadinessProvider);
      const familyConfig = config.zernioFamilies?.[family];
      if (!familyConfig?.enabled) {
        throw new CommsHubError(404, "zernio_family_disabled", "Zernio webhook family is not enabled.", {
          publicMessage: "Webhook endpoint not found.",
        });
      }
      const envelope = readZernioWebhookEnvelope(req, {
        family,
        secret: familyConfig.webhookSecret,
        maxBytes: config.maxWebhookBytes,
      });
      const result = await withZernioAcceptanceDeadline(
        processZernioWebhook({ envelope, correlationId, context: contextProvider() }),
        config.zernioAckTimeoutMs
      );
      recordProviderOutcome({
        routeKey: `comms-hub:zernio-${family}-intake`,
        provider: `zernio-${family}`,
        ok: true,
        durationMs: Date.now() - startedAt,
        status: result.test ? "test" : result.duplicate ? "duplicate" : "accepted",
      });
      log.info("commsHub.socialIntake.accepted", {
        correlationId,
        family,
        platform: envelope.platform,
        eventType: envelope.eventType,
        duplicate: result.duplicate,
        test: result.test,
      });
      return res.status(result.test || result.duplicate ? 200 : 202).json({
        ok: true,
        accepted: true,
        duplicate: result.duplicate,
        test: result.test,
        correlationId,
      });
    } catch (error) {
      const output = publicError(error);
      recordProviderOutcome({
        routeKey: `comms-hub:zernio-${family || "unknown"}-intake`,
        provider: `zernio-${family || "unknown"}`,
        ok: false,
        durationMs: Date.now() - startedAt,
        status: output.normalised.code,
      });
      log[output.statusCode >= 500 ? "error" : "warn"]("commsHub.socialIntake.rejected", {
        correlationId,
        family: family || null,
        error: safeErrorLog(output.normalised),
      });
      return res.status(output.statusCode).json({ ...output.body, correlationId });
    }
  });

  router.get("/diagnostics", async (_req, res, next) => {
    try {
      const active = contextProvider();
      const [schema, archive, social] = await Promise.all([
        active.repository.schemaStatus(),
        active.repository.getArchiveCounts(),
        active.repository.getSocialStatus(),
      ]);
      return res.status(schema.available ? 200 : 503).json({
        ok: schema.available,
        service: "comms-hub",
        schema,
        archive,
        social,
        configuration: {
          forms: 3,
          r2Bucket: active.config.r2BucketName,
          archiveWorkerEnabled: active.config.archiveWorkerEnabled,
          socialPollWorkerEnabled: active.config.socialPollWorkerEnabled,
          d1Transport: active.config.d1ProxyUrl ? "worker-data-plane" : "cloudflare-rest",
          zernio: Object.fromEntries(Object.entries(active.config.zernioFamilies).map(([family, value]) => [family, {
            enabled: value.enabled,
            platforms: value.platforms,
          }])),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/conversations/:conversationId", async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) {
        throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.", {
          publicMessage: "Conversation ID is invalid.",
        });
      }
      const conversation = await contextProvider().repository.getConversation(conversationId);
      if (!conversation) return res.status(404).json({ ok: false, error: "conversation_not_found" });
      return res.status(200).json({ ok: true, service: "comms-hub", conversation });
    } catch (error) {
      next(error);
    }
  });

  router.get("/social/conversations", async (req, res, next) => {
    try {
      const platform = String(req.query.platform || "").trim().toLowerCase();
      if (platform && !["facebook", "instagram", "youtube"].includes(platform)) {
        throw new CommsHubError(400, "social_platform_invalid", "Social platform filter is invalid.");
      }
      const status = String(req.query.status || "").trim().toLowerCase();
      if (status && !["open", "pending", "closed", "quarantined"].includes(status)) {
        throw new CommsHubError(400, "social_status_invalid", "Conversation status filter is invalid.");
      }
      const conversations = await contextProvider().repository.listSocialConversations({
        platform,
        status,
        before: String(req.query.before || "").trim(),
        limit: Number(req.query.limit || 50),
      });
      return res.status(200).json({ ok: true, service: "comms-hub", conversations });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/conversations/:conversationId/actions/:action", async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const result = await executeSocialAction({
        conversationId,
        action: req.params.action,
        body: req.body || {},
        idempotencyKey: req.get("idempotency-key"),
        context: contextProvider(),
      });
      recordProviderOutcome({
        routeKey: `comms-hub:social-action:${req.params.action}`,
        provider: "zernio",
        ok: true,
        durationMs: Date.now() - startedAt,
        status: result.duplicate ? "duplicate" : "complete",
      });
      return res.status(200).json({ ok: true, service: "comms-hub", duplicate: result.duplicate, result: result.response });
    } catch (error) {
      recordProviderOutcome({
        routeKey: `comms-hub:social-action:${req.params.action || "unknown"}`,
        provider: "zernio",
        ok: false,
        durationMs: Date.now() - startedAt,
        status: error?.code || "failed",
      });
      next(error);
    }
  });

  router.get("/social/status", async (_req, res, next) => {
    try {
      const social = await contextProvider().repository.getSocialStatus();
      return res.status(200).json({ ok: true, service: "comms-hub", social });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/poll/drain", async (req, res, next) => {
    try {
      const requested = Number(req.body?.limit || 0);
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 20) : 5;
      const result = await contextProvider().socialPollWorker.runOnce({ limit });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/webhooks/:family/reconcile", async (req, res, next) => {
    try {
      const family = String(req.params.family || "").trim().toLowerCase();
      if (!["meta", "video"].includes(family)) throw new CommsHubError(404, "zernio_family_unknown", "Unknown Zernio family.");
      const result = await reconcileZernioWebhook({ family, context: contextProvider() });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/poll/kick", (_req, res) => {
    const kicked = kickSocialPoll();
    return res.status(kicked ? 202 : 409).json({ ok: kicked, service: "comms-hub", kicked });
  });

  router.get("/archive/status", async (_req, res, next) => {
    try {
      const counts = await contextProvider().repository.getArchiveCounts();
      return res.status(200).json({ ok: true, service: "comms-hub", counts });
    } catch (error) {
      next(error);
    }
  });

  router.post("/archive/drain", async (req, res, next) => {
    try {
      const requested = Number(req.body?.limit || 0);
      const limit = Number.isInteger(requested) && requested > 0
        ? Math.min(requested, contextProvider().config.archiveBatchSize)
        : contextProvider().config.archiveBatchSize;
      const result = await contextProvider().archiveWorker.runOnce({ limit });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) {
      next(error);
    }
  });


  router.post("/conversations/:conversationId/ai/analyse", async (req, res, next) => {
    const startedAt = Date.now();
    try {
      requireReady(runtimeReadinessProvider);
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const result = await contextProvider().aiWorkflowService.analyseConversation(conversationId, {
        operation: String(req.body?.operation || "analyse").trim().slice(0, 100),
        scheduleFollowUp: req.body?.scheduleFollowUp !== false,
      });
      recordProviderOutcome({ routeKey: "comms-hub:ai-analyse", provider: "aims-ai-router", ok: true, durationMs: Date.now() - startedAt, status: "complete" });
      return res.status(201).json({ ok: true, service: "comms-hub", result });
    } catch (error) {
      recordProviderOutcome({ routeKey: "comms-hub:ai-analyse", provider: "aims-ai-router", ok: false, durationMs: Date.now() - startedAt, status: error?.code || "failed" });
      next(error);
    }
  });

  router.get("/conversations/:conversationId/ai", async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const state = await contextProvider().aiRepository.getConversationAiState(conversationId);
      return res.status(200).json({ ok: true, service: "comms-hub", conversationId, ...state });
    } catch (error) { next(error); }
  });

  router.get("/ai/status", async (_req, res, next) => {
    try {
      const active = contextProvider();
      return res.status(200).json({
        ok: true,
        service: "comms-hub",
        enabled: active.config.aiEnabled,
        approvalsEnforced: active.config.approvalsEnforced,
        approvedKnowledgeInstances: active.config.aiSearchApprovedInstances,
        routes: [
          "commsHubTriage", "commsHubModeration", "commsHubSummary",
          "commsHubDraftContact", "commsHubDraftContribute", "commsHubDraftPodcast", "commsHubDraftSocial",
          "commsHubFollowUp",
        ]
          .map((route) => getProviderDiagnosticsForRoute(route)),
      });
    } catch (error) { next(error); }
  });

  router.post("/approvals/:approvalId/decision", async (req, res, next) => {
    try {
      const approvalId = boundedId(req.params.approvalId, "apr");
      if (!approvalId) throw new CommsHubError(400, "approval_id_invalid", "Approval ID is invalid.");
      const approval = await decideApproval({
        repository: contextProvider().aiRepository,
        approvalId,
        decision: req.body?.decision,
        decidedBy: authenticatedActor(req),
        reason: req.body?.reason,
      });
      return res.status(200).json({ ok: true, service: "comms-hub", approval });
    } catch (error) { next(error); }
  });

  router.get("/queue", async (req, res, next) => {
    try {
      const requested = Number(req.query?.limit || 0);
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 50;
      const conversations = await contextProvider().aiRepository.listPriorityQueue({ limit });
      return res.status(200).json({ ok: true, service: "comms-hub", conversations });
    } catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/priority", async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const override = normalisePriorityOverride(req.body || {});
      const createdAt = new Date().toISOString();
      const result = await contextProvider().aiRepository.overridePriority({
        id: stableId("pro", conversationId, override.score, override.reason, createdAt),
        conversationId,
        score: override.score,
        label: override.label,
        reason: override.reason,
        actor: authenticatedActor(req),
        createdAt,
      });
      return res.status(201).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) { next(error); }
  });

  router.post("/drafts/:draftId/send", async (req, res, next) => {
    try {
      const draftId = boundedId(req.params.draftId, "drf");
      if (!draftId) throw new CommsHubError(400, "reply_draft_id_invalid", "Reply draft ID is invalid.");
      const result = await sendReplyDraft({ draftId, context: contextProvider() });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) { next(error); }
  });

  router.post("/social/conversations/:conversationId/approvals/:action", async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const approval = await requestSocialActionApproval({
        conversationId,
        action: req.params.action,
        body: req.body || {},
        idempotencyKey: req.get("idempotency-key"),
        requestedBy: authenticatedActor(req),
        context: contextProvider(),
      });
      return res.status(201).json({ ok: true, service: "comms-hub", approval });
    } catch (error) { next(error); }
  });

  router.post("/workflows/podcast/:conversationId/start", async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const workflow = await contextProvider().podcastWorkflowService.start(conversationId);
      return res.status(201).json({ ok: true, service: "comms-hub", workflow });
    } catch (error) { next(error); }
  });

  router.post("/workflows/podcast/:conversationId/advance", async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const result = await contextProvider().podcastWorkflowService.advance({
        conversationId,
        action: req.body?.action,
        idempotencyKey: req.get("idempotency-key"),
        actor: authenticatedActor(req),
        data: req.body?.data || {},
      });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) { next(error); }
  });

  router.post("/follow-ups/drain", async (req, res, next) => {
    try {
      const requested = Number(req.body?.limit || 0);
      const active = contextProvider();
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, active.config.followUpBatchSize) : active.config.followUpBatchSize;
      const result = await active.followUpWorker.runOnce({ limit });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) { next(error); }
  });

  router.get("/providers/health", async (_req, res, next) => {
    try {
      const health = await contextProvider().providerHealthService.status();
      return res.status(health.overall === "unavailable" ? 503 : 200).json({ ok: health.overall !== "unavailable", service: "comms-hub", health });
    } catch (error) { next(error); }
  });

  router.post("/providers/health/snapshot", async (_req, res, next) => {
    try {
      const captured = await contextProvider().providerHealthService.capture();
      return res.status(201).json({ ok: true, service: "comms-hub", captured: captured.length, providers: captured });
    } catch (error) { next(error); }
  });

  router.post("/backups/run", async (req, res, next) => {
    try {
      const backup = await contextProvider().backupService.runBackup({ actor: authenticatedActor(req) });
      return res.status(201).json({ ok: true, service: "comms-hub", backup });
    } catch (error) { next(error); }
  });

  router.get("/backups/status", async (_req, res, next) => {
    try {
      const status = await contextProvider().aiRepository.getLatestBackupStatus();
      return res.status(200).json({ ok: true, service: "comms-hub", ...status });
    } catch (error) { next(error); }
  });

  router.post("/backups/:backupRunId/validate", async (req, res, next) => {
    try {
      const backupRunId = boundedId(req.params.backupRunId, "bkp");
      if (!backupRunId) throw new CommsHubError(400, "backup_run_id_invalid", "Backup run ID is invalid.");
      const validation = await contextProvider().backupService.validateRestore(backupRunId, { actor: authenticatedActor(req) });
      return res.status(200).json({ ok: true, service: "comms-hub", validation });
    } catch (error) { next(error); }
  });

  return router;
}

export default createCommsHubRouter();
