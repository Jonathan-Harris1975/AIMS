import express from "express";
import { z } from "zod";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  zernioDailyBodySchema,
  zernioQuizBodySchema,
  zernioEbookWeeklyBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { buildAndScheduleDailyLane, buildAndScheduleDailyLaneAccountVariants, buildAndScheduleQuizSeries, buildAndScheduleEbookWeekly } from "../utils/socialScheduler.js";
import { getAsyncServiceRouteJobFresh, shouldRunAsyncServiceRoute, startAsyncServiceRouteJob } from "../../shared/utils/asyncServiceRouteJobs.js";
import { fetchPublishedPostsHistory, inspectZernioTargeting } from "../utils/zernioClient.js";
import { LANE_CONFIG, ZERNIO_PROFILE_NAME_GENERAL, ZERNIO_PROFILE_NAME_EBOOKS, getZernioRequiredPlatforms, getZernioAccountId, normaliseZernioAccountId, parsePlatforms } from "../utils/config.js";

const router = express.Router();

const zernioPublishedHistoryBodySchema = z
  .object({
    maxPages: z.coerce.number().int().min(1).max(20).optional().default(4),
    lookbackDays: z.coerce.number().int().min(1).max(365).optional().default(31),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();

const profileNamesInputSchema = z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(200)).min(1)]).optional();
const platformsInputSchema = z.union([z.string().trim().min(1).max(200), z.array(z.string().trim().min(1).max(80)).min(1)]).optional();

const zernioSetupCheckBodySchema = z
  .object({
    apiKey: z.string().trim().min(1).max(200).optional(),
    profileName: z.string().trim().min(1).max(200).optional(),
    profileNames: profileNamesInputSchema,
    accountId: z.union([z.string().trim().min(1).max(500), z.array(z.string().trim().min(1).max(200)).min(1)]).optional(),
    requiredPlatforms: platformsInputSchema,
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

function defaultProfileNames() {
  return [...new Set([ZERNIO_PROFILE_NAME_GENERAL, ZERNIO_PROFILE_NAME_EBOOKS].filter(Boolean))];
}

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "zernio",
    lanes: Object.keys(LANE_CONFIG),
    quizRoute: "/zernio/quiz/weekly",
    ebookWeeklyRoute: "/zernio/ebooks/weekly",
    publishedHistoryRoute: "/zernio/posts/history",
    time: new Date().toISOString(),
  });
});

router.get("/jobs/:lane/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncServiceRouteJobFresh("zernio", req.params.lane, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, service: "zernio", error: "Zernio async job not found", lane: req.params.lane, sessionId: req.params.sessionId });
  return res.json(job);
}));


router.post(
  "/setup/check",
  hookdeckDedupe("zernio:setup:check"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(zernioSetupCheckBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const body = parsed.data;
    const profileNames = body.profileNames
      ? toList(body.profileNames)
      : body.profileName
        ? [body.profileName]
        : defaultProfileNames();
    const accountId = normaliseZernioAccountId(body.accountId || getZernioAccountId());
    const requiredPlatforms = body.requiredPlatforms
      ? parsePlatforms(Array.isArray(body.requiredPlatforms) ? body.requiredPlatforms.join(",") : body.requiredPlatforms)
      : getZernioRequiredPlatforms();

    const checks = [];
    for (const profileName of profileNames) {
      try {
        checks.push(await inspectZernioTargeting({
          profileName,
          accountId,
          requiredPlatforms,
          includeGlobalAccounts: body.includeGlobalAccounts,
        }, body.apiKey));
      } catch (error) {
        checks.push({
          ok: false,
          profile: { name: profileName },
          accountId,
          requiredPlatforms,
          warnings: [error.message],
          error: error.message,
          availableProfiles: error.availableProfiles || undefined,
        });
      }
    }

    return res.status(checks.every((check) => check.ok) ? 200 : 409).json({
      ok: checks.every((check) => check.ok),
      service: "zernio",
      accountId,
      requiredPlatforms,
      checks,
    });
  })
);

router.post(
  "/posts/history",
  hookdeckDedupe("zernio:posts:history"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(zernioPublishedHistoryBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const { apiKey, lookbackDays, ...options } = parsed.data;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - Number(lookbackDays || 31) * 86400000);
    const result = await fetchPublishedPostsHistory({ ...options, lookbackDays, windowStart, windowEnd }, apiKey);
    return res.json({
      ok: true,
      service: "zernio",
      source: "analytics",
      lookbackDays,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      ...result,
    });
  })
);

for (const laneKey of Object.keys(LANE_CONFIG)) {
  // profileNames (2+) opts into automatic per-account post variants;
  // omitting it keeps the original single-account behaviour unchanged.
  const runDailyLane = (payload) =>
    Array.isArray(payload.profileNames) && payload.profileNames.length > 1
      ? buildAndScheduleDailyLaneAccountVariants(laneKey, payload)
      : buildAndScheduleDailyLane(laneKey, payload);

  router.post(
    `/daily/${laneKey}`,
    hookdeckDedupe(`zernio:${laneKey}`),
    asyncRoute(async (req, res) => {
      const parsed = validateBody(zernioDailyBodySchema, req.body);
      if (!parsed.ok) {
        return res.status(400).json({ ok: false, error: parsed.error });
      }

      if (shouldRunAsyncServiceRoute(req)) {
        const job = await startAsyncServiceRouteJob({
          service: "zernio",
          lane: `daily-${laneKey}`,
          payload: parsed.data,
          req,
          runner: runDailyLane,
          metadata: { route: `/zernio/daily/${laneKey}` },
        });
        return res.status(202).json(job);
      }

      const result = await runDailyLane(parsed.data);
      return res.json(result);
    })
  );
}


router.post(
  "/ebooks/weekly",
  hookdeckDedupe("zernio:ebooks:weekly"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(zernioEbookWeeklyBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    if (shouldRunAsyncServiceRoute(req)) {
      const job = await startAsyncServiceRouteJob({
        service: "zernio",
        lane: "ebooks-weekly",
        payload: parsed.data,
        req,
        runner: buildAndScheduleEbookWeekly,
        metadata: { route: "/zernio/ebooks/weekly" },
      });
      return res.status(202).json(job);
    }

    const result = await buildAndScheduleEbookWeekly(parsed.data);
    return res.status(result.partialFailure ? 207 : 200).json(result);
  })
);

router.post(
  "/quiz/weekly",
  hookdeckDedupe("zernio:quiz:weekly"),
  asyncRoute(async (req, res) => {
    const parsed = validateBody(zernioQuizBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    if (shouldRunAsyncServiceRoute(req)) {
      const job = await startAsyncServiceRouteJob({
        service: "zernio",
        lane: "quiz-weekly",
        payload: parsed.data,
        req,
        runner: buildAndScheduleQuizSeries,
        metadata: { route: "/zernio/quiz/weekly" },
      });
      return res.status(202).json(job);
    }

    const result = await buildAndScheduleQuizSeries(parsed.data);
    return res.status(result.partialFailure ? 207 : 200).json(result);
  })
);

export default router;
