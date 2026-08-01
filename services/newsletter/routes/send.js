// services/newsletter/routes/send.js
import express from "express";
import { warn } from "../../../logger.js";
import { getObjectAsText, buildPublicUrl } from "../../shared/utils/r2-client.js";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
import { validateBody, newsletterSendBodySchema } from "../../shared/utils/requestSchemas.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { buildIssueKeyPrefix, findLatestIssueSessionId } from "../engine/storage.js";
import { deliverNewsletterIssue, getNewsletterDeliveryReadiness, getCampaignStatus } from "../brevo/campaign.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function loadStoredIssue(profile, sessionId, date) {
  const prefix = buildIssueKeyPrefix(profile, { date: date ? new Date(date) : new Date(), sessionId });
  const bucketKey = profile.storage.htmlBucketKey;
  const metadataRaw = await getObjectAsText(bucketKey, `${prefix}/metadata.json`);
  const metadata = JSON.parse(metadataRaw);

  return {
    ok: true,
    newsletter: {
      subject: metadata.subject,
      previewText: metadata.previewText,
      heroHeadline: metadata.heroHeadline,
    },
    storage: {
      prefix,
      htmlUrl: buildPublicUrl(bucketKey, `${prefix}/index.html`),
      emailUrl: buildPublicUrl(bucketKey, `${prefix}/email.html`),
      textUrl: buildPublicUrl(bucketKey, `${prefix}/index.txt`),
      metaUrl: buildPublicUrl(bucketKey, `${prefix}/metadata.json`),
    },
  };
}

// POST /newsletter/send — deliver a previously-built, QA-passed issue via
// Brevo. Scheduling is owned entirely by MAST (a separate repository): this
// route creates the Brevo campaign and sends it immediately (sendNow) the
// moment MAST calls it — there is no internal scheduledAt.
//
// sessionId is optional. The AIMS morning operation runs generate, readiness
// and send sequentially, but it deliberately does not couple routes through an
// in-memory session value. When sessionId is omitted this resolves today's most
// recently built issue for the profile from durable storage, so restarts do not
// break the delivery hand-off. This resolves "today's most recently built
// issue" for the profile itself (see engine/storage.js#findLatestIssueSessionId).
router.post("/send", requestDedupe("newsletter:send"), asyncRoute(async (req, res) => {
  const parsed = validateBody(newsletterSendBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  const { profileId, date } = parsed.data;
  let { sessionId } = parsed.data;
  const profile = getNewsletterProfile(profileId);

  if (!sessionId) {
    sessionId = await findLatestIssueSessionId(profile, { date: date ? new Date(date) : new Date() });
    if (!sessionId) {
      return res.status(404).json({
        ok: false,
        error: `No built issue found for profile '${profile.id}' on ${date || "today"}. Run POST /newsletter/generate first.`,
      });
    }
  }

  let buildResult;
  try {
    buildResult = await loadStoredIssue(profile, sessionId, date);
  } catch (err) {
    return res.status(404).json({
      ok: false,
      error: `Could not find a stored issue for sessionId '${sessionId}' (date ${date || "today"}): ${err.message}`,
    });
  }

  const result = await deliverNewsletterIssue({ profile, sessionId, buildResult });
  if (!result.ok) {
    const configurationStatuses = new Set([
      "sender_pending_validation",
      "audience_empty",
      "audience_not_configured",
      "content_error",
    ]);
    const status = configurationStatuses.has(result.status) ? 409 : 502;
    warn("newsletter.send.blocked", {
      profileId: profile.id,
      sessionId,
      stage: result.stage || null,
      status: result.status || "unknown",
      providerStatus: result.providerStatus || null,
      providerCode: result.providerCode || null,
      error: String(result.error || "newsletter delivery failed").slice(0, 700),
    });
    return res.status(status).json(result);
  }
  return res.json(result);
}));


async function handleReadiness(profileId, res) {
  const profile = getNewsletterProfile(profileId || "ai-edge");
  const result = await getNewsletterDeliveryReadiness({ profile });
  if (!result.ok) {
    const configurationStatuses = new Set([
      "audience_not_configured",
      "audience_empty",
      "sender_not_configured",
      "sender_pending_validation",
    ]);
    return res.status(configurationStatuses.has(result.status) ? 409 : 502).json(result);
  }
  return res.status(result.ready ? 200 : 409).json(result);
}

// GET /newsletter/readiness/:profileId — side-effect-free Brevo delivery
// preflight for operators and diagnostics. It never creates a sender/list.
router.get("/readiness/:profileId?", asyncRoute(async (req, res) => (
  handleReadiness(req.params.profileId || req.query.profileId, res)
)));

// POST /newsletter/readiness — scheduler-compatible, side-effect-free Brevo
// preflight. AIMS operation windows use POST for every internal task, so this
// companion route lets the scheduler prove sender/list readiness before it
// attempts /newsletter/send.
router.post("/readiness", asyncRoute(async (req, res) => (
  handleReadiness(req.body?.profileId || req.query.profileId, res)
)));

// GET /newsletter/campaigns/:campaignId/status — poll Brevo for status/
// performance of a real Brevo campaign.
router.get("/campaigns/:campaignId/status", asyncRoute(async (req, res) => {
  const result = await getCampaignStatus(req.params.campaignId);
  if (!result.ok) return res.status(502).json(result);
  return res.json(result);
}));

export default router;
