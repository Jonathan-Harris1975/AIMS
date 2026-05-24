import express from "express";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { beginJob, completeJob, failJob, getPublicJob } from "../../shared/utils/jobStore.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
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
  newsInsightAutoPublishBodySchema,
  newsInsightBodySchema,
  publishPostBodySchema,
  validatePayload,
} from "../utils/blotatoSchemas.js";
import { buildOrCreateNewsInsightShort } from "../utils/newsShortsService.js";
import {
  DEFAULT_AI_STORY_VIDEO_TEMPLATE_PATH,
  getDefaultBlotatoChannels,
  getDefaultBlotatoTemplateId,
  startBlotatoNewsInsightAutoPublishJob,
} from "../utils/autoPublishService.js";

const router = express.Router();

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function sendValidationError(res, parsed) {
  return res.status(400).json({ ok: false, error: parsed.error });
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
      newsInsightShort: "POST /blotato/shorts/news-insight",
      autoPublishNewsInsightShort: "POST /blotato/shorts/news-insight/publish-now",
      autoPublishStatus: "GET /blotato/jobs/:sessionId",
    },
    defaults: {
      templatePath: DEFAULT_AI_STORY_VIDEO_TEMPLATE_PATH,
      templateId: getDefaultBlotatoTemplateId(),
      channels: getDefaultBlotatoChannels(),
    },
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
    const result = await listSubaccounts(req.params.accountId, req.query?.apiKey);
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
  hookdeckDedupe("blotato:create-visual"),
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
    const result = await getVisualStatus(req.params.id, req.query?.apiKey);
    return res.json({ ok: true, service: "blotato", ...result });
  })
);

router.delete(
  "/visuals/:id",
  hookdeckDedupe("blotato:delete-visual"),
  asyncRoute(async (req, res) => {
    const result = await deleteVisual(req.params.id, req.query?.apiKey || req.body?.apiKey);
    return res.json({ ok: true, service: "blotato", ...result });
  })
);

router.post(
  "/posts",
  hookdeckDedupe("blotato:publish-post"),
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(publishPostBodySchema, req.body);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const { apiKey, ...payload } = parsed.data;
    const result = await publishPost(payload, apiKey);
    return res.status(201).json({ ok: true, service: "blotato", ...result });
  })
);

router.get(
  "/posts/:postSubmissionId",
  asyncRoute(async (req, res) => {
    const result = await getPostStatus(req.params.postSubmissionId, req.query?.apiKey);
    return res.json({ ok: true, service: "blotato", ...result });
  })
);

router.post(
  "/shorts/news-insight",
  hookdeckDedupe("blotato:news-insight-short"),
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(newsInsightBodySchema, req.body);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const result = await buildOrCreateNewsInsightShort(parsed.data);
    return res.status(result.createdVisual ? 201 : 200).json(result);
  })
);

router.post(
  "/shorts/news-insight/publish-now",
  hookdeckDedupe("blotato:news-insight-auto-publish"),
  asyncRoute(async (req, res) => {
    const parsed = validatePayload(newsInsightAutoPublishBodySchema, req.body);
    if (!parsed.ok) return sendValidationError(res, parsed);

    const sessionId = sanitizeSessionId(parsed.data.sessionId || `blotato-${Date.now()}`, "BLT");
    const eventId = req.hookdeckEventId || null;
    const { apiKey, ...safeOptions } = parsed.data;

    const { started, job } = beginJob("blotato", sessionId, {
      eventId,
      route: "blotato.newsInsight.publishNow",
      channels: safeOptions.channels,
      templateId: safeOptions.templateId || getDefaultBlotatoTemplateId(),
    });

    if (!started) {
      return res.status(202).json({
        ok: true,
        duplicateJob: true,
        service: "blotato",
        sessionId,
        status: job?.status || "running",
        statusUrl: `/blotato/jobs/${encodeURIComponent(sessionId)}`,
        job,
      });
    }

    startBlotatoNewsInsightAutoPublishJob({
      sessionId,
      options: { ...safeOptions, apiKey },
      completeJob,
      failJob,
    });

    return res.status(202).json({
      ok: true,
      service: "blotato",
      lane: "news-insight-auto-publish",
      sessionId,
      status: "running",
      statusUrl: `/blotato/jobs/${encodeURIComponent(sessionId)}`,
      message: "Blotato AI news short pipeline started. It will create the video and post immediately to the configured channels.",
      defaults: {
        templateId: safeOptions.templateId || getDefaultBlotatoTemplateId(),
        channels: safeOptions.channels || getDefaultBlotatoChannels(),
      },
    });
  })
);

router.get("/jobs/:sessionId", (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId, "BLT");
  const job = getPublicJob("blotato", sessionId);

  if (!job) {
    return res.status(404).json({ ok: false, service: "blotato", error: "No Blotato job found", sessionId });
  }

  return res.json({ ok: true, service: "blotato", job });
});

export default router;
