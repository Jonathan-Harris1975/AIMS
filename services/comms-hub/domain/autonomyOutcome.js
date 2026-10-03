export const AUTONOMY_CHANNELS = new Set(['chat', 'email', 'form', 'facebook', 'instagram', 'youtube', 'linkedin', 'x', 'threads', 'tiktok']);
export const HOLD_REASONS = new Set(['low_confidence', 'attachment_review', 'approval_required', 'safety_or_conduct', 'missing_information', 'automation_disabled', 'rate_limited']);

export function primaryHoldReason({ intelligence = {}, approval = false, attachmentReview = false, enabled = true } = {}) {
  if (!enabled || intelligence.channelAutoSendEnabled === false) return 'automation_disabled';
  if (intelligence.humanReviewRequired) return 'safety_or_conduct';
  if (attachmentReview) return 'attachment_review';
  if (approval) return 'approval_required';
  if (intelligence.clarificationRequired || intelligence.reasons?.includes('evidence_missing')) return 'missing_information';
  if (intelligence.autonomousEligible !== true && !intelligence.safeClarificationEligible && !intelligence.safeDeterministicResponseEligible) return 'low_confidence';
  return null;
}
