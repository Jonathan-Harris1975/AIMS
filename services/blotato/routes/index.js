import express from "express";
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
  newsInsightBodySchema,
  publishPostBodySchema,
  validatePayload,
} from "../utils/blotatoSchemas.js";
import { buildOrCreateNewsInsightShort } from "../utils/newsShortsService.js";

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

export default router;
