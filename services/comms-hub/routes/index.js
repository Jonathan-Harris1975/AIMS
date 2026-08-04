import express from "express";
import { log } from "../../../logger.js";
import { recordProviderOutcome } from "../../shared/utils/operationalExcellence.js";
import { getProviderDiagnosticsForRoute } from "../../shared/utils/ai-service.js";
import { booleanValue, getCommsHubReadiness, loadCommsHubConfig } from "../config.js";
import { newCorrelationId, stableId } from "../domain/ids.js";
import { normalisePriorityOverride } from "../domain/ai.js";
import { attachCommsIdentity, requireCommsPermission } from "../domain/rbac.js";
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
    req?.commsIdentity?.actor
      || req?.user?.email
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
        approvals: aiEnabled && booleanValue(process.env.COMMS_HUB_APPROVALS_ENFORCED, true),
        backups: booleanValue(process.env.COMMS_HUB_BACKUP_ENABLED, false),
        email: booleanValue(process.env.COMMS_HUB_EMAIL_ENABLED, false),
        chat: booleanValue(process.env.COMMS_HUB_CHAT_ENABLED, false),
        autonomousReplies: aiEnabled && booleanValue(process.env.COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED, false),
        delayedActions: booleanValue(process.env.COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED, false),
        retention: booleanValue(process.env.COMMS_HUB_RETENTION_WORKER_ENABLED, false),
        credentialVault: booleanValue(process.env.COMMS_HUB_CREDENTIAL_VAULT_ENABLED, false),
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

  router.post("/intake/chat", async (req, res) => {
    const correlationId = String(req.id || req.get?.("x-request-id") || newCorrelationId());
    try {
      requireReady(runtimeReadinessProvider);
      const active = contextProvider();
      if (!active.config.chatEnabled) throw new CommsHubError(404, "chat_channel_disabled", "Website chat channel is disabled.");
      const result = await active.chatService.acceptWebhook(req);
      return res.status(result.duplicate ? 200 : 202).json({ ok: true, accepted: true, duplicate: result.duplicate, correlationId });
    } catch (error) {
      const output = publicError(error);
      return res.status(output.statusCode).json({ ...output.body, correlationId });
    }
  });

  router.use(attachCommsIdentity(() => contextProvider().config));
  router.use((req, res, next) => {
    const startedAt = Date.now();
    res.once("finish", () => {
      const path = String(req.route?.path || req.path || "").slice(0, 500);
      const conversationId = validConversationId(req.params?.conversationId) || null;
      void contextProvider().auditService.record({
        actor: req.commsIdentity.actor,
        role: req.commsIdentity.role,
        action: req.method === "GET" || req.method === "HEAD" ? "api_read" : "api_mutation",
        objectType: "api_route",
        objectId: `${req.method}:${path}`,
        conversationId,
        requestId: req.id || null,
        outcome: res.statusCode >= 400 ? "failed" : "success",
        details: { statusCode: res.statusCode, durationMs: Date.now() - startedAt },
      }).catch((error) => log.error("commsHub.audit.routeFailed", { error: safeErrorLog(error), path }));
    });
    next();
  });
  const permit = (permission) => (req, _res, next) => {
    try { requireCommsPermission(req, contextProvider().config, permission); next(); } catch (error) { next(error); }
  };

  router.get("/diagnostics", permit("read_queue"), async (_req, res, next) => {
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

  router.get("/conversations/:conversationId", permit("read_conversation"), async (req, res, next) => {
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

  router.get("/social/conversations", permit("read_queue"), async (req, res, next) => {
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

  router.post("/social/conversations/:conversationId/actions/:action", permit("send_reply"), async (req, res, next) => {
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

  router.get("/social/status", permit("read_queue"), async (_req, res, next) => {
    try {
      const social = await contextProvider().repository.getSocialStatus();
      return res.status(200).json({ ok: true, service: "comms-hub", social });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/poll/drain", permit("manage_workflows"), async (req, res, next) => {
    try {
      const requested = Number(req.body?.limit || 0);
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 20) : 5;
      const result = await contextProvider().socialPollWorker.runOnce({ limit });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/webhooks/:family/reconcile", permit("manage_workflows"), async (req, res, next) => {
    try {
      const family = String(req.params.family || "").trim().toLowerCase();
      if (!["meta", "video"].includes(family)) throw new CommsHubError(404, "zernio_family_unknown", "Unknown Zernio family.");
      const result = await reconcileZernioWebhook({ family, context: contextProvider() });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/social/poll/kick", permit("manage_workflows"), (_req, res) => {
    const kicked = kickSocialPoll();
    return res.status(kicked ? 202 : 409).json({ ok: kicked, service: "comms-hub", kicked });
  });

  router.get("/archive/status", permit("read_queue"), async (_req, res, next) => {
    try {
      const counts = await contextProvider().repository.getArchiveCounts();
      return res.status(200).json({ ok: true, service: "comms-hub", counts });
    } catch (error) {
      next(error);
    }
  });

  router.post("/archive/drain", permit("manage_workflows"), async (req, res, next) => {
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


  router.post("/conversations/:conversationId/ai/analyse", permit("manage_workflows"), async (req, res, next) => {
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

  router.get("/conversations/:conversationId/ai", permit("read_conversation"), async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const state = await contextProvider().aiRepository.getConversationAiState(conversationId);
      return res.status(200).json({ ok: true, service: "comms-hub", conversationId, ...state });
    } catch (error) { next(error); }
  });

  router.get("/ai/status", permit("read_queue"), async (_req, res, next) => {
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

  router.post("/approvals/:approvalId/decision", permit("decide_approval"), async (req, res, next) => {
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

  router.get("/queue", permit("read_queue"), async (req, res, next) => {
    try {
      const conversations = await contextProvider().operationsService.queue({
        status: String(req.query.status || ""), channel: String(req.query.channel || ""),
        ownerId: String(req.query.ownerId || ""), priority: String(req.query.priority || ""),
        tag: String(req.query.tag || ""), overdue: String(req.query.overdue || "") === "true",
        before: String(req.query.before || ""), limit: Number(req.query.limit || 50),
      }, req);
      return res.status(200).json({ ok: true, service: "comms-hub", conversations });
    } catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/priority", permit("update_status"), async (req, res, next) => {
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

  router.post("/drafts/:draftId/send", permit("send_reply"), async (req, res, next) => {
    try {
      const draftId = boundedId(req.params.draftId, "drf");
      if (!draftId) throw new CommsHubError(400, "reply_draft_id_invalid", "Reply draft ID is invalid.");
      const result = await sendReplyDraft({ draftId, context: contextProvider() });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) { next(error); }
  });

  router.post("/social/conversations/:conversationId/approvals/:action", permit("send_reply"), async (req, res, next) => {
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

  router.post("/workflows/podcast/:conversationId/start", permit("manage_workflows"), async (req, res, next) => {
    try {
      const conversationId = validConversationId(req.params.conversationId);
      if (!conversationId) throw new CommsHubError(400, "conversation_id_invalid", "Conversation ID is invalid.");
      const workflow = await contextProvider().podcastWorkflowService.start(conversationId);
      return res.status(201).json({ ok: true, service: "comms-hub", workflow });
    } catch (error) { next(error); }
  });

  router.post("/workflows/podcast/:conversationId/advance", permit("manage_workflows"), async (req, res, next) => {
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

  router.post("/follow-ups/drain", permit("manage_workflows"), async (req, res, next) => {
    try {
      const requested = Number(req.body?.limit || 0);
      const active = contextProvider();
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, active.config.followUpBatchSize) : active.config.followUpBatchSize;
      const result = await active.followUpWorker.runOnce({ limit });
      return res.status(200).json({ ok: true, service: "comms-hub", ...result });
    } catch (error) { next(error); }
  });

  router.get("/providers/health", permit("read_queue"), async (_req, res, next) => {
    try {
      const health = await contextProvider().providerHealthService.status();
      return res.status(health.overall === "unavailable" ? 503 : 200).json({ ok: health.overall !== "unavailable", service: "comms-hub", health });
    } catch (error) { next(error); }
  });

  router.post("/providers/health/snapshot", permit("manage_workflows"), async (_req, res, next) => {
    try {
      const captured = await contextProvider().providerHealthService.capture();
      return res.status(201).json({ ok: true, service: "comms-hub", captured: captured.length, providers: captured });
    } catch (error) { next(error); }
  });

  router.post("/backups/run", permit("run_backups"), async (req, res, next) => {
    try {
      const backup = await contextProvider().backupService.runBackup({ actor: authenticatedActor(req) });
      return res.status(201).json({ ok: true, service: "comms-hub", backup });
    } catch (error) { next(error); }
  });

  router.get("/backups/status", permit("run_backups"), async (_req, res, next) => {
    try {
      const status = await contextProvider().aiRepository.getLatestBackupStatus();
      return res.status(200).json({ ok: true, service: "comms-hub", ...status });
    } catch (error) { next(error); }
  });

  router.post("/backups/:backupRunId/validate", permit("run_backups"), async (req, res, next) => {
    try {
      const backupRunId = boundedId(req.params.backupRunId, "bkp");
      if (!backupRunId) throw new CommsHubError(400, "backup_run_id_invalid", "Backup run ID is invalid.");
      const validation = await contextProvider().backupService.validateRestore(backupRunId, { actor: authenticatedActor(req) });
      return res.status(200).json({ ok: true, service: "comms-hub", validation });
    } catch (error) { next(error); }
  });


  router.get("/workspace/:conversationId", permit("read_conversation"), async (req, res, next) => {
    try { return res.json({ ok: true, service: "comms-hub", workspace: await contextProvider().operationsService.workspace(req.params.conversationId, req) }); }
    catch (error) { next(error); }
  });

  router.patch("/conversations/:conversationId/status", permit("update_status"), async (req, res, next) => {
    try { const result = await contextProvider().operationsService.updateStatus({ conversationId: req.params.conversationId, ...req.body }, req); return res.json({ ok: true, result }); }
    catch (error) { next(error); }
  });

  router.patch("/conversations/:conversationId/assignment", permit("assign"), async (req, res, next) => {
    try { const result = await contextProvider().operationsService.assign({ conversationId: req.params.conversationId, ...req.body }, req); return res.json({ ok: true, result }); }
    catch (error) { next(error); }
  });

  router.post("/tags", permit("tag"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, tag: await contextProvider().operationsService.createTag(req.body || {}, req) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/tags", permit("tag"), async (req, res, next) => {
    try { return res.json({ ok: true, ...(await contextProvider().operationsService.applyTags({ conversationIds: req.body?.conversationIds, tagIds: req.body?.tagIds }, req)) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/notes", permit("note"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, note: await contextProvider().operationsService.addNote({ conversationId: req.params.conversationId, bodyText: req.body?.bodyText, mentions: req.body?.mentions }, req) }); }
    catch (error) { next(error); }
  });

  router.get("/mentions", permit("read_notifications"), async (req, res, next) => {
    try { return res.json({ ok: true, mentions: await contextProvider().operationsRepository.listMentions({ actor: req.commsIdentity.actor, status: String(req.query.status || "unread"), limit: Number(req.query.limit || 100) }) }); }
    catch (error) { next(error); }
  });

  router.patch("/mentions/:id", permit("read_notifications"), async (req, res, next) => {
    try { return res.json({ ok: true, mention: await contextProvider().operationsRepository.markMention({ id: req.params.id, actor: req.commsIdentity.actor, status: req.body?.status || "read" }) }); }
    catch (error) { next(error); }
  });

  router.get("/saved-replies", permit("use_saved_reply"), async (req, res, next) => {
    try { return res.json({ ok: true, replies: await contextProvider().operationsRepository.listSavedReplies({ channel: String(req.query.channel || "") }) }); }
    catch (error) { next(error); }
  });

  router.put("/saved-replies/:key", permit("manage_saved_reply"), async (req, res, next) => {
    try { return res.json({ ok: true, reply: await contextProvider().operationsService.upsertSavedReply({ key: req.params.key, ...req.body }, req) }); }
    catch (error) { next(error); }
  });

  router.post("/saved-replies/:key/render", permit("use_saved_reply"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().operationsService.renderSavedReply({ key: req.params.key, channel: req.body?.channel, values: req.body?.values || {} }, req) }); }
    catch (error) { next(error); }
  });

  router.post("/bulk", permit("bulk_actions"), async (req, res, next) => {
    try { return res.json({ ok: true, ...(await contextProvider().operationsService.bulk(req.body || {}, req)) }); }
    catch (error) { next(error); }
  });

  router.get("/contacts/:contactId", permit("read_conversation"), async (req, res, next) => {
    try { return res.json({ ok: true, profile: await contextProvider().operationsService.contactProfile(req.params.contactId, req) }); }
    catch (error) { next(error); }
  });

  router.post("/identity-links", permit("manage_identity"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, link: await contextProvider().operationsService.proposeIdentityLink(req.body || {}, req) }); }
    catch (error) { next(error); }
  });

  router.post("/identity-links/:id/decision", permit("manage_identity"), async (req, res, next) => {
    try { return res.json({ ok: true, link: await contextProvider().operationsService.reviewIdentityLink({ id: req.params.id, ...req.body }, req) }); }
    catch (error) { next(error); }
  });

  router.get("/search", permit("read_conversation"), async (req, res, next) => {
    try { const results = await contextProvider().operationsService.search({ query: req.query.q, objectType: req.query.objectType, channel: req.query.channel, contactId: req.query.contactId, conversationId: req.query.conversationId, limit: Number(req.query.limit || 50) }, req); return res.json({ ok: true, results }); }
    catch (error) { next(error); }
  });

  router.get("/attachments/:attachmentId", permit("read_conversation"), async (req, res, next) => {
    try { const { record, buffer } = await contextProvider().attachmentService.get(req.params.attachmentId); res.setHeader("content-type", record.content_type); res.setHeader("content-length", String(buffer.length)); res.setHeader("cache-control", "private, no-store"); res.setHeader("content-disposition", `attachment; filename="${String(record.object_key).split('/').at(-1).replace(/[\r\n"]/g, '_')}"`); return res.send(buffer); }
    catch (error) { next(error); }
  });

  router.post("/attachments/:attachmentId/ingest", permit("manage_attachments"), async (req, res, next) => {
    try {
      const buffer = Buffer.from(String(req.body?.base64 || ""), "base64");
      const active = contextProvider();
      if (req.body?.messageId) await active.operationsRepository.ensureAttachmentReference({ id: req.params.attachmentId, messageId: req.body.messageId, provider: req.body?.provider || "api", filename: req.body?.filename, status: "pending", metadata: req.body?.metadata || {} });
      const result = await active.attachmentService.ingest({ attachmentId: req.params.attachmentId, filename: req.body?.filename, contentType: req.body?.contentType || "application/octet-stream", buffer, provider: req.body?.provider || "api", metadata: req.body?.metadata || {} });
      return res.status(201).json({ ok: true, result });
    }
    catch (error) { next(error); }
  });

  router.post("/email/poll/drain", permit("manage_workflows"), async (req, res, next) => {
    try { return res.json({ ok: true, ...(await contextProvider().emailPollWorker.runOnce({ limit: Number(req.body?.limit || 0) || undefined })) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/email", permit("send_reply"), async (req, res, next) => {
    try { const result = await contextProvider().emailService.send({ conversationId: req.params.conversationId, bodyText: req.body?.bodyText, bodyHtml: req.body?.bodyHtml, subject: req.body?.subject, recipients: req.body?.recipients || [], cc: req.body?.cc || [], attachments: [], attachmentIds: req.body?.attachmentIds || [], idempotencyKey: req.get("idempotency-key") }); return res.json({ ok: true, ...result }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/chat", permit("send_reply"), async (req, res, next) => {
    try { const result = await contextProvider().chatService.send({ conversationId: req.params.conversationId, message: req.body?.message, idempotencyKey: req.get("idempotency-key") }); return res.json({ ok: true, ...result }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/chat/takeover", permit("human_takeover"), async (req, res, next) => {
    try { return res.json({ ok: true, session: await contextProvider().chatService.takeover({ conversationId: req.params.conversationId, mode: req.body?.mode, actor: req.commsIdentity.actor }) }); }
    catch (error) { next(error); }
  });

  router.post("/workflow-definitions", permit("manage_workflows"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, definition: await contextProvider().workflowEngineService.createDefinition(req.body || {}, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/workflow-definitions/:key/:version/activate", permit("manage_workflows"), async (req, res, next) => {
    try { return res.json({ ok: true, definition: await contextProvider().workflowEngineService.activateDefinition({ key: req.params.key, version: req.params.version }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.get("/workflow-definitions", permit("read_conversation"), async (req, res, next) => {
    try { return res.json({ ok: true, definitions: await contextProvider().operationsRepository.listWorkflowDefinitions({ key: String(req.query.key || ""), status: String(req.query.status || "") }) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/workflows/:key/start", permit("manage_workflows"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, run: await contextProvider().workflowEngineService.startDefinition({ conversationId: req.params.conversationId, key: req.params.key, data: req.body?.data || {}, idempotencyKey: req.get("idempotency-key") || "" }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.get("/workflow-runs/:runId", permit("read_conversation"), async (req, res, next) => {
    try { const run = await contextProvider().aiRepository.getWorkflowRun(req.params.runId); if (!run) throw new CommsHubError(404, "workflow_run_not_found", "Workflow run was not found."); return res.json({ ok: true, run: { ...run, data: JSON.parse(run.data_json || "{}") } }); }
    catch (error) { next(error); }
  });

  router.post("/workflow-runs/:runId/transition", permit("manage_workflows"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().workflowEngineService.transitionDefinition({ runId: req.params.runId, action: req.body?.action, data: req.body?.data || {}, details: req.body?.details || {}, idempotencyKey: req.get("idempotency-key") || "" }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.put("/routing-rules/:key", permit("manage_rules"), async (req, res, next) => {
    try { return res.json({ ok: true, rule: await contextProvider().workflowEngineService.upsertRule({ key: req.params.key, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/rules/evaluate", permit("manage_rules"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().workflowEngineService.evaluate({ conversationId: req.params.conversationId, trigger: req.body?.trigger || "manual" }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/delayed-actions", permit("manage_workflows"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, action: await contextProvider().workflowEngineService.schedule({ conversationId: req.params.conversationId, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/delayed-actions/drain", permit("manage_workflows"), async (req, res, next) => {
    try { return res.json({ ok: true, ...(await contextProvider().delayedActionWorker.runOnce({ limit: Number(req.body?.limit || 0) || undefined })) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/escalations", permit("manage_escalations"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, escalation: await contextProvider().workflowEngineService.escalate({ conversationId: req.params.conversationId, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.get("/escalations", permit("read_queue"), async (req, res, next) => {
    try { return res.json({ ok: true, escalations: await contextProvider().operationsRepository.listEscalations({ status: String(req.query.status || "open"), severity: String(req.query.severity || ""), limit: Number(req.query.limit || 100) }) }); }
    catch (error) { next(error); }
  });

  router.put("/sla-policies/:key", permit("manage_sla"), async (req, res, next) => {
    try { return res.json({ ok: true, policy: await contextProvider().workflowEngineService.upsertSlaPolicy({ key: req.params.key, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/sla/apply", permit("manage_sla"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().workflowEngineService.applySla(req.params.conversationId, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.put("/autonomous-policies/:key", permit("manage_autonomy"), async (req, res, next) => {
    try { return res.json({ ok: true, policy: await contextProvider().governanceService.upsertAutonomousPolicy({ key: req.params.key, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/autonomous-reply", permit("manage_autonomy"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().governanceService.attemptAutonomousReply({ conversationId: req.params.conversationId, draftId: req.body?.draftId }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.put("/retention-policies/:key", permit("manage_retention"), async (req, res, next) => {
    try { return res.json({ ok: true, policy: await contextProvider().governanceService.upsertRetentionPolicy({ key: req.params.key, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/export", permit("manage_retention"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, export: await contextProvider().governanceService.exportConversation({ conversationId: req.params.conversationId, actor: req.commsIdentity.actor }) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/anonymise", permit("manage_retention"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().governanceService.anonymise({ conversationId: req.params.conversationId, actor: req.commsIdentity.actor }) }); }
    catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/delete", permit("manage_retention"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().governanceService.deleteConversation({ conversationId: req.params.conversationId, actor: req.commsIdentity.actor }) }); }
    catch (error) { next(error); }
  });

  router.post("/retention/drain", permit("manage_retention"), async (req, res, next) => {
    try { return res.json({ ok: true, ...(await contextProvider().retentionWorker.runOnce({ limit: Number(req.body?.limit || 0) || undefined })) }); }
    catch (error) { next(error); }
  });

  router.get("/quarantine", permit("read_queue"), async (req, res, next) => {
    try { return res.json({ ok: true, items: await contextProvider().quarantineService.list({ status: String(req.query.status || "quarantined"), failureClass: String(req.query.failureClass || ""), limit: Number(req.query.limit || 100) }) }); }
    catch (error) { next(error); }
  });

  router.post("/quarantine/:id/replay", permit("replay_quarantine"), async (req, res, next) => {
    try { return res.json({ ok: true, result: await contextProvider().quarantineService.replay(req.params.id, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.get("/metrics", permit("read_metrics"), async (req, res, next) => {
    try { const to = req.query.to || new Date().toISOString(); const from = req.query.from || new Date(Date.parse(to) - 30 * 86400000).toISOString(); return res.json({ ok: true, metrics: await contextProvider().metricsService.get({ from, to }) }); }
    catch (error) { next(error); }
  });

  router.get("/notifications", permit("read_notifications"), async (req, res, next) => {
    try { return res.json({ ok: true, notifications: await contextProvider().notificationService.list({ actor: req.commsIdentity.actor, status: String(req.query.status || "unread"), limit: Number(req.query.limit || 100) }) }); }
    catch (error) { next(error); }
  });

  router.patch("/notifications/:id", permit("read_notifications"), async (req, res, next) => {
    try { return res.json({ ok: true, notification: await contextProvider().notificationService.mark({ id: req.params.id, actor: req.commsIdentity.actor, status: req.body?.status || "read" }) }); }
    catch (error) { next(error); }
  });

  router.put("/credentials/:key", permit("manage_credentials"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, credential: await contextProvider().credentialVaultService.put({ key: req.params.key, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.put("/credentials/:key/oauth", permit("manage_credentials"), async (req, res, next) => {
    try { return res.status(201).json({ ok: true, credential: await contextProvider().credentialVaultService.putOAuth({ key: req.params.key, ...req.body }, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.post("/credentials/:key/oauth/refresh", permit("manage_credentials"), async (req, res, next) => {
    try { const token = await contextProvider().credentialVaultService.getOAuthAccessToken(req.params.key, { forceRefresh: true }, req.commsIdentity); return res.json({ ok: true, token: { tokenType: token.tokenType, scopes: token.scopes, expiresAt: token.expiresAt } }); }
    catch (error) { next(error); }
  });

  router.delete("/credentials/:key", permit("manage_credentials"), async (req, res, next) => {
    try { return res.json({ ok: true, credential: await contextProvider().credentialVaultService.disable(req.params.key, req.commsIdentity) }); }
    catch (error) { next(error); }
  });

  router.get("/ui/bootstrap", permit("read_queue"), async (req, res, next) => {
    try { const [queue, notifications] = await Promise.all([contextProvider().operationsService.queue({ limit: 50 }, req), contextProvider().notificationService.list({ actor: req.commsIdentity.actor, status: "unread", limit: 20 })]); return res.json({ ok: true, apiVersion: 1, responsiveContract: { minimumWidth: 320, pagination: "cursor", actions: ["assign", "status", "tag", "note", "reply", "takeover"] }, identity: req.commsIdentity, queue, notifications }); }
    catch (error) { next(error); }
  });

  return router;
}

export default createCommsHubRouter();
