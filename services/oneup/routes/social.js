import express from "express";
import { z } from "zod";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  oneupDailyBodySchema,
  oneupQuizBodySchema,
  oneupEbookWeeklyBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { buildAndScheduleDailyLane, buildAndScheduleQuizSeries, buildAndScheduleEbookWeekly } from "../utils/socialScheduler.js";
import { fetchPublishedPostsHistory, inspectOneUpTargeting } from "../utils/oneupClient.js";
import { LANE_CONFIG, ONEUP_CATEGORY_NAME_GENERAL, ONEUP_CATEGORY_NAME_EBOOKS, getOneUpRequiredNetworkTypes, getOneUpSocialNetworkId, normaliseOneUpSocialNetworkId, parseNetworkTypes } from "../utils/config.js";

const router = express.Router();

const oneupPublishedHistoryBodySchema = z
  .object({
    start: z.coerce.number().int().min(0).max(100000).optional().default(0),
    maxPages: z.coerce.number().int().min(1).max(20).optional().default(4),
    lookbackDays: z.coerce.number().int().min(1).max(365).optional().default(31),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();

const categoryNamesInputSchema = z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(200)).min(1)]).optional();
const networkTypesInputSchema = z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(80)).min(1)]).optional();

const oneupSetupCheckBodySchema = z
  .object({
    apiKey: z.string().trim().min(1).max(200).optional(),
    categoryName: z.string().trim().min(1).max(200).optional(),
    categoryNames: categoryNamesInputSchema,
    socialNetworkId: z.union([z.string().trim().min(1).max(500), z.array(z.string().trim().min(1).max(200)).min(1)]).optional(),
    requiredNetworkTypes: networkTypesInputSchema,
    includeGlobalAccounts: z.coerce.boolean().optional().default(true),
  })
  .passthrough();

function toList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[;,]/g).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function defaultCategoryNames() {
  return [...new Set([ONEUP_CATEGORY_NAME_GENERAL, ONEUP_CATEGORY_NAME_EBOOKS].filter(Boolean))];
}

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "oneup",
    lanes: Object.keys(LANE_CONFIG),
    quizRoute: "/oneup/quiz/weekly",
    ebookWeeklyRoute: "/oneup/ebooks/weekly",
    publishedHistoryRoute: "/oneup/posts/history",
    time: new Date().toISOString(),
  });
});


router.post(
  "/setup/check",
  hookdeckDedupe("oneup:setup:check"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(oneupSetupCheckBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const body = parsed.data;
    const categoryNames = body.categoryNames
      ? toList(body.categoryNames)
      : body.categoryName
        ? [body.categoryName]
        : defaultCategoryNames();
    const socialNetworkId = normaliseOneUpSocialNetworkId(body.socialNetworkId || getOneUpSocialNetworkId());
    const requiredNetworkTypes = body.requiredNetworkTypes
      ? parseNetworkTypes(Array.isArray(body.requiredNetworkTypes) ? body.requiredNetworkTypes.join(",") : body.requiredNetworkTypes)
      : getOneUpRequiredNetworkTypes();

    const checks = [];
    for (const categoryName of categoryNames) {
      try {
        checks.push(await inspectOneUpTargeting({
          categoryName,
          socialNetworkId,
          requiredNetworkTypes,
          includeGlobalAccounts: body.includeGlobalAccounts,
        }, body.apiKey));
      } catch (error) {
        checks.push({
          ok: false,
          category: { category_name: categoryName },
          socialNetworkId,
          requiredNetworkTypes,
          warnings: [error.message],
          error: error.message,
          availableCategories: error.availableCategories || undefined,
        });
      }
    }

    return res.status(checks.every((check) => check.ok) ? 200 : 409).json({
      ok: checks.every((check) => check.ok),
      service: "oneup",
      socialNetworkId,
      requiredNetworkTypes,
      checks,
    });
  })
);

router.post(
  "/posts/history",
  hookdeckDedupe("oneup:posts:history"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(oneupPublishedHistoryBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const { apiKey, lookbackDays, ...options } = parsed.data;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - Number(lookbackDays || 31) * 86400000);
    const result = await fetchPublishedPostsHistory({ ...options, lookbackDays, windowStart, windowEnd }, apiKey);
    return res.json({
      ok: true,
      service: "oneup",
      source: "getpublishedposts",
      lookbackDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      ...result,
    });
  })
);

for (const laneKey of Object.keys(LANE_CONFIG)) {
  router.post(
    `/daily/${laneKey}`,
    hookdeckDedupe(`oneup:${laneKey}`),
    asyncRoute(async (req, res) => {
      const parsed = validateBody(oneupDailyBodySchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ ok: false, error: parsed.error });
      }

      const result = await buildAndScheduleDailyLane(laneKey, parsed.data);
      return res.json(result);
    })
  );
}


router.post(
  "/ebooks/weekly",
  hookdeckDedupe("oneup:ebooks:weekly"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(oneupEbookWeeklyBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const result = await buildAndScheduleEbookWeekly(parsed.data);
    return res.status(result.partialFailure ? 207 : 200).json(result);
  })
);

router.post(
  "/quiz/weekly",
  hookdeckDedupe("oneup:quiz:weekly"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(oneupQuizBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const result = await buildAndScheduleQuizSeries(parsed.data);
    return res.status(result.partialFailure ? 207 : 200).json(result);
  })
);

export default router;
