// services/blog/routes/weekly.js
import express from "express";
import { buildWeeklyBlogPost } from "../weekly/buildWeeklyBlogPost.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { validateBody, blogWeeklyBuildBodySchema } from "../../shared/utils/requestSchemas.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /blog/weekly/build
router.post("/build", hookdeckDedupe("blog:weeklyBuild"), asyncRoute(async (req, res) => {
  const parsed = validateBody(blogWeeklyBuildBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const requestedDays = parsed.data.days;
  const weekId = parsed.data.weekId;

  const result = await buildWeeklyBlogPost({ days: requestedDays, weekId });
  if (!result?.ok) {
    return res.status(500).json(result);
  }
  return res.json(result);
}));

export default router;
