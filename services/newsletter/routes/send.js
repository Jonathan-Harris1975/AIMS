// services/newsletter/routes/send.js
import express from "express";
import { getObjectAsText, buildPublicUrl } from "../../shared/utils/r2-client.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { validateBody, newsletterSendBodySchema } from "../../shared/utils/requestSchemas.js";
import { getNewsletterProfile } from "../config/profiles.js";
import { buildIssueKeyPrefix } from "../engine/storage.js";
import { deliverNewsletterIssue, getCampaignStatus } from "../emailoctopus/campaign.js";

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
      htmlUrl: buildPublicUrl(bucketKey, `${prefix}/index.html`),
      textUrl: buildPublicUrl(bucketKey, `${prefix}/index.txt`),
      metaUrl: buildPublicUrl(bucketKey, `${prefix}/metadata.json`),
    },
  };
}

// POST /newsletter/send — deliver a previously-built, QA-passed issue.
// EmailOctopus v2 has no documented campaign-creation endpoint, so this
// either creates a real campaign (only if explicitly enabled — see
// THRESHOLDS.newsletter.attemptUndocumentedCampaignCreate) or stores a
// ready-to-send packet in R2 and returns status "pending_manual_send".
router.post("/send", hookdeckDedupe("newsletter:send"), asyncRoute(async (req, res) => {
  const parsed = validateBody(newsletterSendBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  const { profileId, sessionId, date, scheduledFor } = parsed.data;
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

  const result = await deliverNewsletterIssue({ profile, sessionId, buildResult, scheduledFor });
  return res.json(result);
}));

// GET /newsletter/campaigns/:campaignId/status — poll EmailOctopus for
// status/performance of a campaign that has a real EmailOctopus campaign ID.
router.get("/campaigns/:campaignId/status", asyncRoute(async (req, res) => {
  const result = await getCampaignStatus(req.params.campaignId);
  if (!result.ok) return res.status(502).json(result);
  return res.json(result);
}));

export default router;
