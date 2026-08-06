// services/newsletter/brevo/sender.js
//
// Brevo requires a sender to exist and be validated before a campaign can be
// dispatched. Inspection is side-effect-free; creation is reserved for the
// explicit delivery path.

import { info, warn } from "../../../logger.js";
import { getSenders, createSender } from "./client.js";

function isVerified(sender) {
  if (typeof sender?.active === "boolean") return sender.active;
  if (typeof sender?.verified === "boolean") return sender.verified;
  return false;
}

function findSender(senders, email) {
  return (senders || []).find((sender) => String(sender?.email || "").toLowerCase() === String(email || "").toLowerCase()) || null;
}

export async function inspectSender({ email }) {
  if (!email) {
    return { ok: false, status: "sender_not_configured", error: "No Brevo sender email is configured for this newsletter profile." };
  }

  const list = await getSenders();
  if (!list.ok) {
    return { ok: false, status: "sender_lookup_failed", error: list.error, providerStatus: list.status, providerCode: list.code };
  }

  const existing = findSender(list.data?.senders, email);
  if (!existing) {
    return {
      ok: false,
      status: "sender_not_configured",
      email,
      error: `Sender ${email} does not exist in Brevo.`,
    };
  }

  const verified = isVerified(existing);
  return {
    ok: true,
    exists: true,
    verified,
    senderId: existing.id,
    email: existing.email || email,
    status: verified ? "ready" : "sender_pending_validation",
  };
}

/**
 * Looks up the configured sender and creates it only when delivery explicitly
 * asks for it. Brevo then emails the one-time validation code.
 */
export async function ensureSender({ name, email }) {
  const inspected = await inspectSender({ email });
  if (inspected.ok) {
    if (!inspected.verified) {
      warn("newsletter.brevo.sender_not_verified", { senderId: inspected.senderId, email });
    }
    return { ...inspected, justCreated: false };
  }
  if (inspected.status !== "sender_not_configured" || !email) return inspected;

  const created = await createSender({ name, email });
  if (!created.ok) {
    return { ok: false, status: "sender_create_failed", error: created.error, providerStatus: created.status, providerCode: created.code };
  }

  info("newsletter.brevo.sender_created", { senderId: created.data?.id, email });
  warn("newsletter.brevo.sender_pending_otp", {
    senderId: created.data?.id,
    email,
    note: "Brevo emailed a one-time passcode to this address. Validate the sender before delivery can continue.",
  });

  return {
    ok: true,
    exists: true,
    senderId: created.data?.id,
    email,
    verified: false,
    status: "sender_pending_validation",
    justCreated: true,
  };
}

export default { inspectSender, ensureSender };
