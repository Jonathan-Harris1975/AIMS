import express from "express";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  oneupDailyBodySchema,
  oneupQuizBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { buildAndScheduleDailyLane, buildAndScheduleQuizSeries } from "../utils/socialScheduler.js";
import { LANE_CONFIG } from "../utils/config.js";

const router = express.Router();

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "oneup",
    lanes: Object.keys(LANE_CONFIG),
    quizRoute: "/oneup/quiz/weekly",
    time: new Date().toISOString(),
  });
});

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
