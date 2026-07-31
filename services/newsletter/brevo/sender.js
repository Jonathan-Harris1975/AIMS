// services/newsletter/brevo/sender.js
//
// Brevo requires a sender to exist and be verified before campaign delivery.
// Inspection is side-effect free; creation remains an explicit consequence of
// an attempted send, where the pending OTP state is returned clearly.

import { info, warn } from "../../../logger.js";
import { getSenders, createSender } from "./client.js";

function isVerified(sender) {
  if (typeof sender?.active === "boolean") return sender.active;
  if (typeof sender?.verified === "boolean") return sender.verified;
  return false;
}

export async function inspectSender({ email }) {
  if (!email) return { ok: false, error: "No sender email configured for this profile." };

  const list = await getSenders();
  if (!list.ok) {
    return {
      ok: false,
      error: list.error,
      providerStatus: list.status,
      providerCode: list.code,
    };
  }

  const existing = (list.data?.senders || []).find(
    (sender) => String(sender.email || "").toLowerCase() === String(email).toLowerCase(),
  );

  if (!existing) return { ok: true, exists: false, email, verified: false, senderId: null };
  return {
    ok: true,
    exists: true,
    senderId: existing.id,
    email,
    verified: isVerified(existing),
  };
}

export async function ensureSender({ name, email }) {
  const inspected = await inspectSender({ email });
  if (!inspected.ok) return inspected;

  if (inspected.exists) {
    if (!inspected.verified) {
      warn("newsletter.brevo.sender_not_verified", { senderId: inspected.senderId, email });
    }
    return { ...inspected, justCreated: false };
  }

  const created = await createSender({ name, email });
  if (!created.ok) {
    return {
      ok: false,
      error: created.error,
      providerStatus: created.status,
      providerCode: created.code,
    };
  }

  info("newsletter.brevo.sender_created", { senderId: created.data?.id, email });
  warn("newsletter.brevo.sender_pending_otp", {
    senderId: created.data?.id,
    email,
    note: "Brevo emailed a one-time passcode to this address. Complete sender verification before the campaign send route is retried.",
  });

  return {
    ok: true,
    exists: true,
    senderId: created.data?.id,
    email,
    verified: false,
    justCreated: true,
  };
}

export default { inspectSender, ensureSender };
