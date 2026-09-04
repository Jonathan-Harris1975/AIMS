import { stableId } from "./domain/ids.js";
import { sanitiseUntrustedText, scanPromptInjection } from "./domain/promptSecurity.js";

const FORM_LANES = Object.freeze({
  case_study: Object.freeze(["blog", "social", "blotato_video", "zernio_mini_series"]),
  podcast_enquiry: Object.freeze(["podcast", "blog", "social", "blotato_video", "zernio_mini_series"]),
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
    if (lane === "blotato_video") return config.contentAutomationBlotatoVideoEnabled !== false;
    if (lane === "zernio_mini_series") return config.contentAutomationZernioMiniSeriesEnabled !== false;
    return false;
  });
}

export function buildEditorialSignals(digest, maximumFacts = 12) {
  return (digest?.facts || [])
    .slice(0, Math.max(1, Math.min(30, Number(maximumFacts) || 12)))
    .map((item) => ({
      label: clean(item?.label || "Submission detail", 180),
      value: clean(item?.value, 2200),
    }))
    .filter((item) => item.label && item.value);
}

export function deterministicContentCompleteness(signals = []) {
  const values = (signals || []).map((item) => String(item?.value || "").trim()).filter(Boolean);
  const totalCharacters = values.reduce((sum, value) => sum + value.length, 0);
  const substantive = values.filter((value) => value.length >= 120).length;
  const veryShort = values.filter((value) => value.length < 35).length;
  const countScore = Math.min(1, values.length / 6);
  const depthScore = Math.min(1, totalCharacters / 1800);
  const substanceScore = values.length ? substantive / values.length : 0;
  const placeholderPenalty = values.length ? Math.min(0.35, (veryShort / values.length) * 0.35) : 0.35;
  const score = Math.max(0, Math.min(1, (countScore * 0.3) + (depthScore * 0.35) + (substanceScore * 0.35) - placeholderPenalty));
  return Object.freeze({
    score: Number(score.toFixed(3)),
    fieldCount: values.length,
    substantiveFieldCount: substantive,
    totalCharacters,
  });
}

export function combineContentQuality({ completeness, ai } = {}) {
  const completenessScore = Number(completeness?.score || 0);
  const coherence = Number(ai?.coherence || 0);
  const narrativeStrength = Number(ai?.narrativeStrength || 0);
  const brandFit = Number(ai?.brandFit || 0);
  const factualSafety = 1 - Number(ai?.factualRisk || 0);
  const score = Math.max(0, Math.min(1,
    (completenessScore * 0.30)
    + (coherence * 0.22)
    + (narrativeStrength * 0.16)
    + (brandFit * 0.24)
    + (factualSafety * 0.08)
  ));
  return Number(score.toFixed(3));
}

export class CommsHubContentAutomationService {
  constructor({ context, enqueueBrief = null }) {
    this.context = context;
    this.enqueueBrief = enqueueBrief;
  }

  async scheduleVerifiedSubmission({ intake, duplicate = false }) {
    if (!this.context.config.contentAutomationEnabled) return { scheduled: false, reason: "content_automation_disabled" };
    if (duplicate) return { scheduled: false, reason: "duplicate_submission" };
    const candidates = enabledLanes(this.context.config, intake?.route?.key);
    if (!candidates.length) return { scheduled: false, reason: "form_not_content_eligible" };
    const dueAt = new Date(Date.now() + 5_000).toISOString();
    const action = await this.context.workflowEngineService.schedule({
      conversationId: intake.conversationId,
      actionType: "content_automation",
      dueAt,
      payload: {
        formId: intake.formId,
        submissionId: intake.submissionId,
        formKey: intake.route.key,
        candidateLanes: candidates,
      },
      idempotencyKey: `content-automation:${intake.formId}:${intake.submissionId}`,
      maxAttempts: this.context.config.contentAutomationMaxAttempts,
    }, { actor: "jotform-content-automation", role: "admin" });
    return { scheduled: true, candidateLanes: candidates, actionId: action?.id || null, dueAt: action?.due_at || dueAt };
  }

  async holdForReview({ conversationId, formKey, quality, threshold, reason }) {
    await this.context.operationsRepository.updateFormProcessing?.({ conversationId, status: "review_required", error: `content_quality:${reason}` }).catch(() => null);
    await this.context.auditService?.record?.({
      actor: "content-automation",
      role: "admin",
      action: "content_automation_review_required",
      objectType: "conversation",
      objectId: conversationId,
      conversationId,
      details: { formKey, quality, threshold, reason },
    }).catch?.(() => null);
    await this.context.notificationService?.create?.({
      actor: "admin",
      conversationId,
      type: "content_quality_review",
      title: "Jotform content held for quality review",
      bodyText: `A verified ${String(formKey || "content").replace(/_/g, " ")} submission scored ${quality?.score ?? 0} against the ${threshold} automation threshold.`,
      severity: "warning",
      emailRequested: false,
      idempotencySeed: `content-quality:${conversationId}:${quality?.score ?? "unknown"}`,
      metadata: { formKey, quality, threshold, reason },
    }).catch?.(() => null);
    return { queued: false, reviewRequired: true, reason, quality, threshold };
  }

  async process({ conversationId, payload = {} }) {
    if (!this.context.config.contentAutomationEnabled) return { skipped: true, reason: "content_automation_disabled" };
    const state = await this.context.operationsRepository.getFormProcessing?.(conversationId);
    if (!state?.digest) return { skipped: true, reason: "form_digest_unavailable" };

    const formKey = String(state.form_key || state.digest.formKey || payload.formKey || "").trim();
    const candidates = enabledLanes(this.context.config, formKey).filter((lane) => !payload.candidateLanes || payload.candidateLanes.includes(lane));
    if (!candidates.length) return { skipped: true, reason: "form_not_content_eligible" };

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
      return this.holdForReview({ conversationId, formKey, quality: { score: 0 }, threshold: this.context.config.contentAutomationQualityMinimumScore, reason: "prompt_injection_detected" });
    }

    const signals = buildEditorialSignals(state.digest, this.context.config.contentAutomationMaxFacts);
    if (!signals.length) return this.holdForReview({ conversationId, formKey, quality: { score: 0 }, threshold: this.context.config.contentAutomationQualityMinimumScore,
       reason: "no_substantive_editorial_signals" });

    const completeness = deterministicContentCompleteness(signals);
    let aiQuality;
    try {
      aiQuality = await this.context.aiWorkflowService.assessContentSubmission({ conversationId, formKey, editorialSignals: signals, allowedLanes: candidates });
    } catch (error) {
      return this.holdForReview({ conversationId, formKey, quality: { score: completeness.score, completeness, aiAssessmentUnavailable: true }, threshold:
         this.context.config.contentAutomationQualityMinimumScore, reason: error?.code || "quality_assessment_failed" });
    }
    const score = combineContentQuality({ completeness, ai: aiQuality });
    const threshold = Number(this.context.config.contentAutomationQualityMinimumScore ?? 0.78);
    const selectedLane = candidates.includes(aiQuality.selectedLane) ? aiQuality.selectedLane : candidates[0];
    const quality = Object.freeze({ score, completeness, ai: aiQuality, selectedLane });
    if (score < threshold || aiQuality.factualRisk >= 0.55 || aiQuality.brandFit < 0.55) {
      const reason = aiQuality.factualRisk >= 0.55 ? "factual_risk" : aiQuality.brandFit < 0.55 ? "brand_fit_below_floor" : "quality_below_threshold";
      return this.holdForReview({ conversationId, formKey, quality, threshold, reason });
    }

    const createdAt = new Date().toISOString();
    const briefBase = {
      schemaVersion: 2,
      id: stableId("cab", payload.formId || state.form_id || formKey, payload.submissionId || state.submission_id || conversationId),
      source: {
        type: "verified_jotform",
        formKey,
        formId: payload.formId || state.form_id || state.digest.formId || null,
        submissionId: payload.submissionId || state.submission_id || state.digest.submissionId || null,
        conversationId,
      },
      editorialSignals: signals,
      quality,
      routing: { selectedLane, rationale: aiQuality.rationale || "quality-gated best-fit route" },
      controls: {
        directIdentifiersExcluded: true,
        untrustedInputSanitised: true,
        factualUse: "editorial_direction_only",
        mustRemainSourceGrounded: true,
        mustNotPromisePublicationOrParticipation: true,
        qualityGatePassed: true,
      },
      createdAt,
    };

    const enqueueBrief = this.enqueueBrief || (await import("./contentAutomationQueue.js")).enqueueEditorialBrief;
    const queued = await enqueueBrief({ lane: selectedLane, brief: { ...briefBase, id: `${briefBase.id}-${selectedLane}` } });

    await this.context.auditService?.record?.({
      actor: "content-automation",
      role: "admin",
      action: "content_automation_queued",
      objectType: "conversation",
      objectId: conversationId,
      conversationId,
      details: { formKey, selectedLane, quality, threshold, submissionIdPresent: Boolean(briefBase.source.submissionId), signalCount: signals.length },
    }).catch?.(() => null);

    return { queued: true, formKey, lane: selectedLane, lanes: [selectedLane], quality, threshold, signalCount: signals.length, key: queued?.key || null, keys: queued?.key ? [queued.key] : [] };
  }
}

export default CommsHubContentAutomationService;
