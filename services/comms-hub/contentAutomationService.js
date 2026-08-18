import { stableId } from "./domain/ids.js";
import { sanitiseUntrustedText, scanPromptInjection } from "./domain/promptSecurity.js";

const FORM_LANES = Object.freeze({
  case_study: Object.freeze(["blog", "social"]),
  podcast_enquiry: Object.freeze(["podcast", "social"]),
});

function clean(value, max = 3000) {
  return sanitiseUntrustedText(String(value ?? ""), max).trim();
}

function enabledLanes(config, formKey) {
  const requested = FORM_LANES[formKey] || [];
  return requested.filter((lane) => {
    if (lane === "blog") return config.contentAutomationBlogEnabled !== false;
    if (lane === "social") return config.contentAutomationSocialEnabled !== false;
    if (lane === "podcast") return config.contentAutomationPodcastEnabled !== false;
    return false;
  });
}

function buildEditorialSignals(digest, maximumFacts = 12) {
  return (digest?.facts || [])
    .slice(0, Math.max(1, Math.min(30, Number(maximumFacts) || 12)))
    .map((item) => ({
      label: clean(item?.label || "Submission detail", 180),
      value: clean(item?.value, 2200),
    }))
    .filter((item) => item.label && item.value);
}

export class CommsHubContentAutomationService {
  constructor({ context, enqueueBrief = null }) {
    this.context = context;
    this.enqueueBrief = enqueueBrief;
  }

  async scheduleVerifiedSubmission({ intake, duplicate = false }) {
    if (!this.context.config.contentAutomationEnabled) return { scheduled: false, reason: "content_automation_disabled" };
    if (duplicate) return { scheduled: false, reason: "duplicate_submission" };
    const lanes = enabledLanes(this.context.config, intake?.route?.key);
    if (!lanes.length) return { scheduled: false, reason: "form_not_content_eligible" };
    const dueAt = new Date(Date.now() + 5_000).toISOString();
    const action = await this.context.workflowEngineService.schedule({
      conversationId: intake.conversationId,
      actionType: "content_automation",
      dueAt,
      payload: {
        formId: intake.formId,
        submissionId: intake.submissionId,
        formKey: intake.route.key,
        lanes,
      },
      idempotencyKey: `content-automation:${intake.formId}:${intake.submissionId}`,
      maxAttempts: this.context.config.contentAutomationMaxAttempts,
    }, { actor: "jotform-content-automation", role: "admin" });
    return { scheduled: true, lanes, actionId: action?.id || null, dueAt: action?.due_at || dueAt };
  }

  async process({ conversationId, payload = {} }) {
    if (!this.context.config.contentAutomationEnabled) return { skipped: true, reason: "content_automation_disabled" };
    const state = await this.context.operationsRepository.getFormProcessing?.(conversationId);
    if (!state?.digest) return { skipped: true, reason: "form_digest_unavailable" };

    const formKey = String(state.form_key || state.digest.formKey || payload.formKey || "").trim();
    const lanes = enabledLanes(this.context.config, formKey).filter((lane) => !payload.lanes || payload.lanes.includes(lane));
    if (!lanes.length) return { skipped: true, reason: "form_not_content_eligible" };

    const rawSecurityInput = (state.digest?.facts || [])
      .slice(0, Math.max(1, Math.min(30, Number(this.context.config.contentAutomationMaxFacts) || 12)))
      .map((item) => `${String(item?.label || "")}\n${String(item?.value || "")}`)
      .join("\n\n");
    const security = scanPromptInjection(rawSecurityInput);
    if (security.detected) {
      await this.context.auditService?.record?.({
        actor: "content-automation",
        role: "admin",
        action: "content_automation_blocked",
        objectType: "conversation",
        objectId: conversationId,
        conversationId,
        details: { reason: "prompt_injection_detected", riskLevel: security.riskLevel, fingerprint: security.fingerprint },
      }).catch?.(() => null);
      return { skipped: true, reason: "prompt_injection_detected", riskLevel: security.riskLevel };
    }

    const signals = buildEditorialSignals(state.digest, this.context.config.contentAutomationMaxFacts);
    if (!signals.length) return { skipped: true, reason: "no_substantive_editorial_signals" };

    const createdAt = new Date().toISOString();
    const briefBase = {
      schemaVersion: 1,
      id: stableId("cab", payload.formId || state.form_id || formKey, payload.submissionId || state.submission_id || conversationId),
      source: {
        type: "verified_jotform",
        formKey,
        formId: payload.formId || state.form_id || state.digest.formId || null,
        submissionId: payload.submissionId || state.submission_id || state.digest.submissionId || null,
        conversationId,
      },
      editorialSignals: signals,
      controls: {
        directIdentifiersExcluded: true,
        untrustedInputSanitised: true,
        factualUse: "editorial_direction_only",
        mustRemainSourceGrounded: true,
        mustNotPromisePublicationOrParticipation: true,
      },
      createdAt,
    };

    const enqueueBrief = this.enqueueBrief || (await import("./contentAutomationQueue.js")).enqueueEditorialBrief;
    const queued = [];
    for (const lane of lanes) {
      queued.push(await enqueueBrief({ lane, brief: { ...briefBase, id: `${briefBase.id}-${lane}` } }));
    }

    await this.context.auditService?.record?.({
      actor: "content-automation",
      role: "admin",
      action: "content_automation_queued",
      objectType: "conversation",
      objectId: conversationId,
      conversationId,
      details: { formKey, lanes, submissionIdPresent: Boolean(briefBase.source.submissionId), signalCount: signals.length },
    }).catch?.(() => null);

    return { queued: true, formKey, lanes, signalCount: signals.length, keys: queued.map((item) => item.key) };
  }
}

export default CommsHubContentAutomationService;
