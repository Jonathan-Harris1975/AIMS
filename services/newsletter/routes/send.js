// services/newsletter/routes/send.js
import express from "express";
import { getObjectAsText, buildPublicUrl } from "../../shared/utils/r2-client.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { validateBody, newsletterSendBodySchema } from "../../shared/utils/requestSchemas.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { buildIssueKeyPrefix } from "../engine/storage.js";
import { deliverNewsletterIssue, getCampaignStatus } from "../brevo/campaign.js";

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
      textUrl: buildPublicUrl(bucketKey, `${prefix}/index.txt`),
      metaUrl: buildPublicUrl(bucketKey, `${prefix}/metadata.json`),
    },
  };
}

// POST /newsletter/send — deliver a previously-built, QA-passed issue via
// Brevo. Scheduling is owned entirely by MAST (a separate repository): this
// route creates the Brevo campaign and sends it immediately (sendNow) the
// moment MAST calls it — there is no internal scheduledAt.
router.post("/send", hookdeckDedupe("newsletter:send"), asyncRoute(async (req, res) => {
  const parsed = validateBody(newsletterSendBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  const { profileId, sessionId, date } = parsed.data;
  const profile = getNewsletterProfile(profileId);

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
    const status = result.status === "sender_pending_validation" ? 409 : 502;
    return res.status(status).json(result);
  }
  return res.json(result);
}));

// GET /newsletter/campaigns/:campaignId/status — poll Brevo for status/
// performance of a real Brevo campaign.
router.get("/campaigns/:campaignId/status", asyncRoute(async (req, res) => {
  const result = await getCampaignStatus(req.params.campaignId);
  if (!result.ok) return res.status(502).json(result);
  return res.json(result);
}));

export default router;
