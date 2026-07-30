import express from "express";
import { log } from "../../../logger.js";
import { recordProviderOutcome } from "../../shared/utils/operationalExcellence.js";
import { getCommsHubReadiness, loadCommsHubConfig } from "../config.js";
import { newCorrelationId } from "../domain/ids.js";
import { readJotformWebhookEnvelope } from "../domain/webhook.js";
import { safeErrorLog } from "../domain/redaction.js";
import { CommsHubError, toCommsHubError } from "../errors.js";
import { getCommsHubContext, getCommsHubRuntimeReadiness, kickCommsHubArchiveDrain } from "../runtime.js";
import { processJotformIntake } from "../intakeService.js";

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

export function createCommsHubRouter({
  contextProvider = getCommsHubContext,
  kickArchive = kickCommsHubArchiveDrain,
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
      },
      runtime: {
        status: runtime.status,
        ready: runtime.ready,
        detail: runtime.detail,
      },
      channels: {
        jotform: ["contact", "case_study", "podcast_enquiry"],
        socialConfigurationOwner: "zernio",
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
      const runtime = runtimeReadinessProvider();
      if (!runtime.ready) {
        throw new CommsHubError(503, "comms_hub_not_ready", `Comms Hub runtime is not ready: ${runtime.status || "unknown"}.`, {
          retryable: true,
          failureClass: "temporary",
          publicMessage: "Comms Hub is not ready.",
        });
      }
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

  router.get("/diagnostics", async (_req, res, next) => {
    try {
      const active = contextProvider();
      const [schema, archive] = await Promise.all([
        active.repository.schemaStatus(),
        active.repository.getArchiveCounts(),
      ]);
      return res.status(schema.available ? 200 : 503).json({
        ok: schema.available,
        service: "comms-hub",
        schema,
        archive,
        configuration: {
          forms: 3,
          r2Bucket: active.config.r2BucketName,
          archiveWorkerEnabled: active.config.archiveWorkerEnabled,
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
      if (!conversation) {
        return res.status(404).json({ ok: false, error: "conversation_not_found" });
      }
      return res.status(200).json({ ok: true, service: "comms-hub", conversation });
    } catch (error) {
      next(error);
    }
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
