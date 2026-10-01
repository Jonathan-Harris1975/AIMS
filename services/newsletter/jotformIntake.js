import { randomUUID } from "node:crypto";
import { normaliseJotformAnswers, extractJotformContact } from "../comms-hub/domain/submission.js";
import { beginSubscription } from "./audience/d1Audience.js";
import { CommsHubError } from "../comms-hub/errors.js";

const FORM_ID = "262733359026055";
const PUBLICATION_ID = "ai-edge";
const GLOSSARY_URL = "https://jonathan-harris.online/downloads/ai-glossary-cheat-sheet/ai-glossary-cheat-sheet.pdf";

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(text).filter(Boolean).join(" ");
  return String(value ?? "").trim();
}

function semantic(answer) {
  return `${answer?.name || ""} ${answer?.label || ""}`.trim().toLowerCase();
}

function namedAnswer(answers, pattern) {
  return answers.find((answer) => pattern.test(semantic(answer)) && text(answer.value));
}

function hasAffirmativeConsent(answer) {
  if (!answer) return false;
  const value = text(answer.value).toLowerCase();
  return value.includes("yes")
    && value.includes("ai edge")
    && value.includes("newsletter")
    && value.includes("unsubscribe");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function confirmationEmail({ firstName, confirmationUrl }) {
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const htmlGreeting = escapeHtml(greeting);
  const subject = "Confirm your AI Edge subscription + your AI glossary";
  const bodyText = `${greeting}\n\nThanks for signing up for AI Edge. Please confirm your subscription using the link below:\n\n${confirmationUrl}\n\nYour free AI glossary cheat sheet is ready here:\n${GLOSSARY_URL}\n\nIf you did not request this, you can ignore this email.\n\nJonathan Harris`;
  const bodyHtml = `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Inter,Arial,sans-serif;color:#334155"><div style="max-width:640px;margin:0 auto;padding:36px 20px"><div style="background:#ffffff;border:1px solid #cbd5e1;border-radius:18px;padding:32px"><p style="margin:0 0 18px">${htmlGreeting}</p><h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;color:#111827">Confirm your AI Edge subscription</h1><p style="margin:0 0 22px;line-height:1.7">Thanks for signing up for AI Edge. One click confirms that this email address belongs to you and completes your subscription.</p><p style="margin:0 0 26px"><a href="${confirmationUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#4338ca;color:#ffffff;text-decoration:none;font-weight:700">Confirm my subscription</a></p><hr style="border:0;border-top:1px solid #e2e8f0;margin:26px 0"><h2 style="margin:0 0 10px;font-size:20px;color:#111827">Your free AI glossary cheat sheet</h2><p style="margin:0 0 18px;line-height:1.7">You can download the plain-English AI glossary now and keep it as a quick reference.</p><p style="margin:0 0 26px"><a href="${GLOSSARY_URL}" style="color:#4338ca;font-weight:700">Download the AI glossary PDF →</a></p><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">If you did not request this subscription, ignore this email. You will not be added to the active AI Edge audience unless you confirm.</p><p style="margin:24px 0 0">Jonathan Harris</p></div></div></body></html>`;
  return { subject, bodyText, bodyHtml };
}

export async function processNewsletterJotformSignup({ identifiers, context }) {
  if (identifiers?.formId !== FORM_ID || identifiers?.route?.key !== "newsletter_signup") {
    throw new CommsHubError(403, "newsletter_jotform_not_allowed", "Jotform is not registered for newsletter signup.");
  }
  const submission = await context.jotform.verifySubmission({ formId: identifiers.formId, submissionId: identifiers.submissionId });
  const answers = normaliseJotformAnswers(submission);
  const contact = extractJotformContact(answers);
  const firstName = text(namedAnswer(answers, /(^|\s)first\s*name($|\s)/)?.value).slice(0, 100);
  const consent = namedAnswer(answers, /email\s*consent|newsletter\s*consent/);
  if (!contact.email) throw new CommsHubError(400, "newsletter_email_missing", "Newsletter signup requires an email address.", { publicMessage: "Email address is required." });
  if (!hasAffirmativeConsent(consent)) {
    throw new CommsHubError(400, "newsletter_consent_missing", "Newsletter signup requires explicit affirmative email consent.", { publicMessage: "Email consent is required." });
  }

  const sourceReference = `jotform:${identifiers.formId}:${identifiers.submissionId}`;
  const alreadySent = await context.d1.query(`SELECT id FROM newsletter_consent_events WHERE source_reference=? AND event_type='confirmation_sent' LIMIT 1`, [sourceReference]);
  if (alreadySent.results?.length) return { ok: true, duplicate: true, status: "confirmation_already_sent" };

  const result = await beginSubscription({
    email: contact.email,
    publicationId: PUBLICATION_ID,
    source: "jotform",
    sourceReference,
    consentTextVersion: process.env.NEWSLETTER_CONSENT_TEXT_VERSION || "2026-10-01",
    privacyNoticeVersion: process.env.NEWSLETTER_PRIVACY_NOTICE_VERSION || "2026-10-01",
  }, { d1: context.d1 });
  if (!result.ok) throw new CommsHubError(result.status === "suppressed" ? 409 : 400, `newsletter_${result.status}`, result.error || "Newsletter signup could not be started.");

  const mail = context.manualMailAccounts?.newsletter;
  if (!mail) throw new CommsHubError(503, "newsletter_sender_not_configured", "Newsletter confirmation sender is not configured.", { retryable: true, failureClass: "temporary" });
  const base = String(process.env.COMMS_HUB_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) throw new CommsHubError(503, "newsletter_public_base_url_missing", "COMMS_HUB_PUBLIC_BASE_URL is required for newsletter confirmation links.");
  const confirmationUrl = `${base}/newsletter/confirm/${encodeURIComponent(result.token)}`;
  await mail.sendMessage({ to: [contact.email], ...confirmationEmail({ firstName, confirmationUrl }) });
  await context.d1.query(`INSERT INTO newsletter_consent_events(id,subscriber_id,publication_id,event_type,lawful_basis,purpose,consent_text_version,privacy_notice_version,source,source_reference,occurred_at,metadata_json)
    VALUES(?,?,?,'confirmation_sent','consent','email_newsletter',?,?,?,?,?,?)`, [
    randomUUID(), result.subscriberId, PUBLICATION_ID,
    process.env.NEWSLETTER_CONSENT_TEXT_VERSION || "2026-10-01",
    process.env.NEWSLETTER_PRIVACY_NOTICE_VERSION || "2026-10-01",
    "jotform", sourceReference, new Date().toISOString(), JSON.stringify({ formId: identifiers.formId }),
  ]);
  return { ok: true, duplicate: false, status: "confirmation_sent" };
}

export const NEWSLETTER_JOTFORM_FORM_ID = FORM_ID;
export const NEWSLETTER_GLOSSARY_URL = GLOSSARY_URL;
