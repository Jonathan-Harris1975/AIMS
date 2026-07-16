// services/newsletter/brevo/sender.js
//
// Brevo requires a sender to be created AND verified (via a one-time
// passcode emailed to that address) before it can be used on a campaign.
// The OTP step cannot be automated from here — it requires reading an
// inbox — so this module's job is to make sure a sender exists and to
// surface, clearly and actionably, when it is still waiting on that manual
// step, rather than silently failing at send time.

import { info, warn } from "../../../logger.js";
import { getSenders, createSender } from "./client.js";

function isVerified(sender) {
  // Brevo's sender object reports verification as `active`; guard against
  // schema drift by also accepting an explicit `verified` flag if present.
  if (typeof sender?.active === "boolean") return sender.active;
  if (typeof sender?.verified === "boolean") return sender.verified;
  return false;
}

/**
 * Looks up the configured sender by email. If it doesn't exist yet, creates
 * it (Brevo will email an OTP to that address). Never attempts OTP
 * validation itself.
 */
export async function ensureSender({ name, email }) {
  if (!email) return { ok: false, error: "No sender email configured for this profile." };

  const list = await getSenders();
  if (!list.ok) return { ok: false, error: list.error };

  const existing = (list.data?.senders || []).find((s) => String(s.email).toLowerCase() === email.toLowerCase());

  if (existing) {
    const verified = isVerified(existing);
    if (!verified) {
      warn("newsletter.brevo.sender_not_verified", { senderId: existing.id, email });
    }
    return { ok: true, senderId: existing.id, email, verified, justCreated: false };
  }

  const created = await createSender({ name, email });
  if (!created.ok) return { ok: false, error: created.error };

  info("newsletter.brevo.sender_created", { senderId: created.data?.id, email });
  warn("newsletter.brevo.sender_pending_otp", {
    senderId: created.data?.id,
    email,
    note: "Brevo emailed a one-time passcode to this address. Verify it via PUT /v3/senders/{id}/validate (Brevo dashboard, or a manual API call) before this profile can send.",
  });

  return { ok: true, senderId: created.data?.id, email, verified: false, justCreated: true };
}

export default { ensureSender };
