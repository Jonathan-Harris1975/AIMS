import express from "express";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
import {
  createVisual,
  deleteVisual,
  getBlotatoConfigSummary,
  getPostStatus,
  getVisualStatus,
  listAccounts,
  listSubaccounts,
  listTemplates,
  publishPost,
} from "../utils/blotatoClient.js";
import {
  createVisualBodySchema,
  listAccountsQuerySchema,
  listTemplatesQuerySchema,
  newsInsightBodySchema,
  publishPostBodySchema,
  validatePayload,
} from "../utils/blotatoSchemas.js";
import { buildOrCreateNewsInsightShort, buildOrCreateShortLane } from "../utils/newsShortsService.js";
import { listShortLaneConfigs, requireShortLaneConfig } from "../utils/shortLanes.js";
import { getPublishNowJob, triggerPublishNowJob } from "../utils/autoPublishService.js";
import { getAutoShortStyleConfigSummary, getAutoShortStyleRotation } from "../utils/autoShortStyles.js";

const router = express.Router();

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function sendValidationError(res, parsed) {
  return res.status(400).json({ ok: false, error: parsed.error });
}

function immediatePublishingEnabled() {
  // Production social publishing is schedule-only. Keeping the legacy flag
  // here used to allow an old MAST trigger to bypass the scheduler and create
  // instant posts, even though the scheduled routes were correctly configured.
  // Development/test can still opt in explicitly.
  const configured = ["1", "true", "yes", "on", "y"].includes(String(process.env.BLOTATO_ALLOW_IMMEDIATE_PUBLISH || "false").trim().toLowerCase());
  const production = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  return configured && !production;
}

function requireScheduledBlotatoRoute(res) {
  if (immediatePublishingEnabled()) return false;
  res.status(409).json({
    ok: false,
    service: "blotato",
    code: "blotato-scheduled-publishing-required",
    error: "Immediate Blotato publishing is disabled. Use /blotato/autoshorts/schedule or /blotato/shorts/:lane/schedule.",
  });
  return true;
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "blotato",
    ...getBlotatoConfigSummary(),
    routes: {
      accounts: "GET /blotato/accounts?platform=tiktok",
      subaccounts: "GET /blotato/accounts/:accountId/subaccounts",
      templates: "GET /blotato/templates?search=AI&fields=id,name,description,inputs",
      createVisual: "POST /blotato/visuals",
      visualStatus: "GET /blotato/visuals/:id",
      publishPost: "POST /blotato/posts",
      postStatus: "GET /blotato/posts/:postSubmissionId",
      lanes: "GET /blotato/shorts/lanes",
      newsInsightShort: "POST /blotato/shorts/news-insight",
      laneShort: "POST /blotato/shorts/:lane",
      scheduleAm: "POST /blotato/autoshorts/schedule",
      scheduleLane: "POST /blotato/shorts/:lane/schedule",
      immediatePublishingEnabled: immediatePublishingEnabled(),
      jobStatus: "GET /blotato/jobs/:sessionId",
    },
    autoShortStyles: getAutoShortStyleConfigSummary(),
    time: new Date().toISOString(),
  });
});

router.get(
  "/accounts",
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(listAccountsQuerySchema, req.query);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const { apiKey, platform } = parsed.data;
    const result = await listAccounts({ platform }, apiKey);
    return res.json({ ok: true, service: "blotato", platform: platform || null, ...result });
  })
);

router.get(
  "/accounts/:accountId/subaccounts",
  asyncRoute(async (req, res) => {
    const apiKey = req.get("x-blotato-api-key") || req.query?.apiKey;
    const result = await listSubaccounts(req.params.accountId, apiKey);
    return res.json({ ok: true, service: "blotato", accountId: req.params.accountId, ...result });
  })
);

router.get(
  "/templates",
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(listTemplatesQuerySchema, req.query);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const { apiKey, ...query } = parsed.data;
    const result = await listTemplates(query, apiKey);
    return res.json({ ok: true, service: "blotato", query, ...result });
  })
);

router.post(
  "/visuals",
  requestDedupe("blotato:create-visual"),
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(createVisualBodySchema, req.body);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const { apiKey, ...payload } = parsed.data;
    const result = await createVisual(payload, apiKey);
    return res.status(201).json({ ok: true, service: "blotato", ...result });
  })
);

router.get(
  "/visuals/:id",
  asyncRoute(async (req, res) => {
    const apiKey = req.get("x-api-key");
    const result = await getVisualStatus(req.params.id, apiKey);
    return res.json({ ok: true, service: "blotato", ...result });
  })
);

router.delete(
  "/visuals/:id",
  requestDedupe("blotato:delete-visual"),
  asyncRoute(async (req, res) => {
    const apiKey = req.get("x-api-key") || req.get("authorization") || req.body?.apiKey;
    const result = await deleteVisual(req.params.id, apiKey);
    return res.json({ ok: true, service: "blotato", ...result });
  })
);

router.post(
  "/posts",
  requestDedupe("blotato:publish-post"),
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(publishPostBodySchema, req.body);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const { apiKey, ...payload } = parsed.data;
    if (!payload.scheduledTime && requireScheduledBlotatoRoute(res)) return undefined;
    const result = await publishPost(payload, apiKey);
    return res.status(201).json({ ok: true, service: "blotato", ...result });
  })
);

router.get(
  "/posts/:postSubmissionId",
  asyncRoute(async (req, res) => {
    const apiKey = req.get("x-api-key");
    const result = await getPostStatus(req.params.postSubmissionId, apiKey);
    return res.json({ ok: true, service: "blotato", ...result });
  })
);



router.get("/shorts/lanes", (_req, res) => {
  res.json({
    ok: true,
    service: "blotato",
    lanes: listShortLaneConfigs(),
  });
});


router.post(
  "/autoshorts/schedule",
  requestDedupe("blotato:autoshorts:schedule"),
  asyncRoute(async (req, res) => {
    const now = new Date();
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(now).toLowerCase();
    const laneByWeekday = { monday: "news-insight", tuesday: "model-verdict", wednesday: "ai-at-work", thursday: "reality-check", friday: "ai-playbook" };
    const laneSlug = laneByWeekday[weekday] || "news-insight";
    const style = getAutoShortStyleRotation(now);
    const result = await triggerPublishNowJob(req, laneSlug, { creativeStyle: style.creativeStyle, publishMode: "autoshorts-scheduled", scheduleSlot: "am" });
    return res.status(result.statusCode || 202).json({ ok: true, service: "blotato", lane: "autoshorts-scheduled", style, sourceLane: laneSlug, message:
       "Blotato AM scheduled-post job accepted.", ...result });
  })
);

router.post(
  "/shorts/:lane/schedule",
  requestDedupe("blotato:lane:schedule"),
  asyncRoute(async (req, res) => {
    const lane = requireShortLaneConfig(req.params.lane);
    const result = await triggerPublishNowJob(req, lane.slug, { publishMode: "evening-scheduled", scheduleSlot: "pm" });
    return res.status(result.statusCode || 202).json({ ok: true, service: "blotato", lane: `${lane.slug}-scheduled`, message: `Blotato ${lane.label} scheduled-post job accepted.`, ...result });
  })
);

router.post(
  "/autoshorts/publish-now",
  asyncRoute(async (req, res) => {
    if (requireScheduledBlotatoRoute(res)) return undefined;
    const now = new Date();
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(now).toLowerCase();
    const laneByWeekday = { monday: "news-insight", tuesday: "model-verdict", wednesday: "ai-at-work", thursday: "reality-check", friday: "ai-playbook" };
    const laneSlug = laneByWeekday[weekday] || "news-insight";
    const style = getAutoShortStyleRotation(now);
    const result = await triggerPublishNowJob(req, laneSlug, { creativeStyle: style.creativeStyle, publishMode: "autoshorts-style" });
    return res.status(result.statusCode || 202).json({
      ok: true,
      service: "blotato",
      lane: "autoshorts-style-publish-now",
      style,
      sourceLane: laneSlug,
      message: `Blotato AutoShort style ${style.styleNumber}/${style.styleCount} publish job accepted.`,
      ...result,
    });
  })
);

router.post(
  "/shorts/news-insight/publish-now",
  asyncRoute(async (req, res) => {
    if (requireScheduledBlotatoRoute(res)) return undefined;
    const result = await triggerPublishNowJob(req, "news-insight");
    return res.status(result.statusCode || 202).json({
      ok: true,
      service: "blotato",
      lane: "news-insight-publish-now",
      message: "Blotato RSS news insight short publish job accepted.",
      ...result,
    });
  })
);


router.post(
  "/shorts/:lane/publish-now",
  asyncRoute(async (req, res) => {
    if (requireScheduledBlotatoRoute(res)) return undefined;
    const lane = requireShortLaneConfig(req.params.lane);
    const result = await triggerPublishNowJob(req, lane.slug);
    return res.status(result.statusCode || 202).json({
      ok: true,
      service: "blotato",
      lane: `${lane.slug}-publish-now`,
      message: `Blotato RSS ${lane.label} short publish job accepted.`,
      ...result,
    });
  })
);


router.get(
  "/jobs/:sessionId",
  asyncRoute(async (req, res) => {
    const job = await getPublishNowJob(req.params.sessionId);
    if (!job) {
      return res.status(404).json({
        ok: false,
        service: "blotato",
        error: "Blotato publish job not found",
        sessionId: req.params.sessionId,
      });
    }

    return res.json({ ok: true, service: "blotato", job });
  })
);

router.post(
  "/shorts/news-insight",
  requestDedupe("blotato:news-insight-short"),
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(newsInsightBodySchema, req.body);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const result = await buildOrCreateNewsInsightShort(parsed.data);
    return res.status(result.createdVisual ? 201 : 200).json(result);
  })
);

router.post(
  "/shorts/:lane",
  requestDedupe("blotato:lane-short"),
  asyncRoute(async (req, res) => {
    const lane = requireShortLaneConfig(req.params.lane);
    const parsed = validatePayload(newsInsightBodySchema, { ...req.body, lane: lane.slug });
    if (!parsed.ok) return sendValidationError(res, parsed);

    const result = await buildOrCreateShortLane({ ...parsed.data, lane: lane.slug });
    return res.status(result.createdVisual ? 201 : 200).json(result);
  })
);

export default router;
