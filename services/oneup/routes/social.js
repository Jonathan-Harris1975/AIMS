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
import { fetchPublishedPostsHistory } from "../utils/oneupClient.js";
import { LANE_CONFIG } from "../utils/config.js";

const router = express.Router();

const oneupPublishedHistoryBodySchema = z
  .object({
    start: z.coerce.number().int().min(0).max(100000).optional().default(0),
    maxPages: z.coerce.number().int().min(1).max(20).optional().default(4),
    lookbackDays: z.coerce.number().int().min(1).max(365).optional().default(31),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();


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
    return res.json(result);
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
    return res.json(result);
  })
);

export default router;
