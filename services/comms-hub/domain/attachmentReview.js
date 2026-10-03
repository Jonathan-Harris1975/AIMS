import { CommsHubError } from '../errors.js';

// The clean object row is written only after scanning the SHA and promoting it
// out of quarantine. A reference labelled "stored" alone is never clearance.
export function attachmentStatesSafe(rows, expectedCount = 0) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || !Array.isArray(rows) || rows.length < expectedCount) return false;
  return rows.every((row) => row && row.attachment_status === 'stored'
    && row.scan_status === 'clean' && !row.deleted_at
    && /^[a-f0-9]{64}$/i.test(row.sha256 || '')
    && typeof row.object_key === 'string' && row.object_key.startsWith('attachments/')
    && row.bucket_name && row.scan_provider && Number.isFinite(Date.parse(row.scanned_at)));
}

export async function attachmentReviewState(context, conversationId, digest = {}) {
  const expected = Number(digest.attachmentCount || (digest.attachmentReviewRequired ? 1 : 0));
  if (!Number.isSafeInteger(expected) || expected < 0) return { reviewRequired: true, reason: 'invalid_attachment_summary' };
  try {
    const read = context.operationsRepository?.listAttachmentReviewStates;
    if (!read) return { reviewRequired: expected > 0, reason: expected > 0 ? 'status_unavailable' : null };
    const rows = await read.call(context.operationsRepository, conversationId);
    const safe = attachmentStatesSafe(rows, expected);
    return { reviewRequired: !safe, reason: safe ? null : 'unresolved_attachment' };
  } catch {
    return { reviewRequired: true, reason: 'status_read_failed' };
  }
}

export async function assertFormAttachmentsSafe(context, conversation) {
  if (conversation.channel !== 'form') return;
  const state = await context.operationsRepository?.getFormProcessing?.(conversation.id);
  const digest = state?.digest || { attachmentCount: conversation.attachments?.length || 0 };
  const result = await attachmentReviewState(context, conversation.id, digest);
  if (result.reviewRequired) throw new CommsHubError(409, 'form_attachment_review_required', 'Form attachments require review before autonomous dispatch.', {
    failureClass: 'recoverable', publicMessage: 'This submission requires attachment review.',
  });
}
