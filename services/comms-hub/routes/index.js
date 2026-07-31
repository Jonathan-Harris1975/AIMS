import express from "express";
import { log } from "../../../logger.js";
import { recordProviderOutcome } from "../../shared/utils/operationalExcellence.js";
import { getCommsHubReadiness, loadCommsHubConfig } from "../config.js";
import { newCorrelationId } from "../domain/ids.js";
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
import { executeSocialAction } from "../socialActionsService.js";
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

  return router;
}

export default createCommsHubRouter();
