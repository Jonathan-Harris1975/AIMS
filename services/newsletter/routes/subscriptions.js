import express from "express";
import { loadCommsHubConfig } from "../../comms-hub/config.js";
import { OneComMailClient } from "../../comms-hub/clients/oneComMailClient.js";
import { confirmSubscription, unsubscribe } from "../audience/d1Audience.js";
import { D1Client } from "../../comms-hub/clients/d1Client.js";
import { sendSubscriptionConfirmation } from "../confirmationDelivery.js";
import { recordNewsletterOutcome } from "../telemetry.js";
import { deliverTodaysIssueToSubscriber } from "../delivery/aimsDelivery.js";

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function newsletterMailer() {
  const config = loadCommsHubConfig(process.env, { requireEnabled: true });
  const account = config.manualEmailAccounts?.newsletter;
  if (!account?.enabled) return null;
  return new OneComMailClient({
    ...config,
    oneComEmailAccountKey: account.key,
    oneComEmailAddress: account.address,
    oneComEmailUsername: account.username,
    oneComEmailPassword: account.password,
    oneComMailbox: account.mailbox,
  });
}

export function createNewsletterSubscriptionRouter({
  env = process.env,
  d1Provider = () => new D1Client(loadCommsHubConfig(env, { requireEnabled: true })),
  mailer = newsletterMailer,
  confirm = confirmSubscription,
  withdraw = unsubscribe,
  deliverIssue = deliverTodaysIssueToSubscriber,
} = {}) {
const router = express.Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
router.post("/subscribe", asyncRoute(async (req, res) => {
  if (req.body?.consent !== true) {
    recordNewsletterOutcome('validation_rejected');
    return res.status(400).json({ ok: false, status: "consent_required", error: "Explicit newsletter consent is required." });
  }
  const mail = mailer();
  const d1 = d1Provider();
  const result = await sendSubscriptionConfirmation({ input: {
    email: req.body?.email,
    publicationId: req.body?.profileId || "ai-edge",
    source: req.body?.source || "website",
    sourceReference: req.body?.sourceReference || "",
    consentTextVersion: env.NEWSLETTER_CONSENT_TEXT_VERSION || "2026-10-01",
    privacyNoticeVersion: env.NEWSLETTER_PRIVACY_NOTICE_VERSION || "2026-10-01",
  }, d1, mail, baseUrl: env.COMMS_HUB_PUBLIC_BASE_URL,
    compose: ({ confirmationUrl }) => ({ subject: "Confirm your AI Edge subscription",
      bodyText: `Confirm your subscription to AI Edge:\n\n${confirmationUrl}\n\nIf you did not request this, ignore this email.`,
      bodyHtml: `<p>Confirm your subscription to <strong>AI Edge</strong>.</p><p><a href="${confirmationUrl}">Confirm subscription</a></p><p>If you did not request this, ignore this email.</p>`,
    }),
  });
  if (!result.ok) return res.status(result.status === "suppressed" ? 409 : 400).json(result);
  return res.status(result.status === 'already_subscribed' ? 200 : 202).json({ ok: true, status: result.status, expiresAt: result.expiresAt });
}));

router.get("/confirm/:token", asyncRoute(async (req, res) => {
  const result = await confirm(req.params.token);
  if (!result.ok) {
    return res.status(400).type("html").send("<!doctype html><title>Confirmation failed</title><h1>Confirmation link invalid or expired</h1>");
  }

  // A new subscriber should not have to wait for the next scheduled issue if
  // today's QA-passed newsletter already exists. This is deliberately best
  // effort: subscription confirmation succeeds even if R2 or mail delivery is
  // temporarily unavailable, and the normal newsletter send remains able to
  // pick up the active subscriber later.
  const todaysIssue = result.duplicate ? { status: 'already_confirmed' } : await deliverIssue({
    subscriberId: result.subscriberId,
    email: result.email,
    publicationId: result.publicationId,
    date: new Date(),
  });
  const issueMessage = todaysIssue.status === "sent"
    ? "<p>Today's AI Edge newsletter has also been sent to your inbox.</p>"
    : todaysIssue.status === "already_sent"
      ? "<p>Today's AI Edge newsletter is already in your inbox.</p>"
      : "";
  return res.status(200).type("html").send(`<!doctype html><title>AI Edge subscription confirmed</title><h1>Subscription confirmed</h1><p>You are now subscribed to AI Edge.</p>${issueMessage}`);
}));

router.get("/unsubscribe/:token", asyncRoute(async (req, res) => {
  const result = await withdraw(req.params.token);
  return res.status(result.ok ? 200 : 400).type("html").send(result.ok
    ? "<!doctype html><title>Unsubscribed</title><h1>You are unsubscribed</h1><p>No further AI Edge marketing emails will be sent to this address.</p>"
    : "<!doctype html><title>Unsubscribe failed</title><h1>Unsubscribe link invalid</h1>");
}));

return router;
}

export default createNewsletterSubscriptionRouter();
