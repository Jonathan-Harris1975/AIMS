// services/blog/routes/weekly.js
import express from "express";
import { buildWeeklyBlogPost } from "../weekly/buildWeeklyBlogPost.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { validateBody, blogWeeklyBuildBodySchema } from "../../shared/utils/requestSchemas.js";
import { getAsyncServiceRouteJobFresh, shouldRunAsyncServiceRoute, startAsyncServiceRouteJob } from "../../shared/utils/asyncServiceRouteJobs.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get("/jobs/:lane/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncServiceRouteJobFresh("blog", req.params.lane, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, service: "blog", error: "Blog async job not found", lane: req.params.lane, sessionId: req.params.sessionId });
  return res.json(job);
}));

// POST /blog/weekly/build
router.post("/build", hookdeckDedupe("blog:weeklyBuild"), asyncRoute(async (req, res) => {
  const parsed = validateBody(blogWeeklyBuildBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const requestedDays = parsed.data.days;
  const weekId = parsed.data.weekId;

  if (shouldRunAsyncServiceRoute(req)) {
    const job = await startAsyncServiceRouteJob({
      service: "blog",
      lane: "weekly-build",
      payload: { days: requestedDays, weekId, ...parsed.data },
      req,
      runner: (payload) => buildWeeklyBlogPost({ days: payload.days, weekId: payload.weekId }),
      metadata: { route: "/blog/weekly/build" },
    });
    return res.status(202).json(job);
  }

  const result = await buildWeeklyBlogPost({ days: requestedDays, weekId });
  if (!result?.ok) {
    return res.status(500).json(result);
  }
  return res.json(result);
}));

export default router;
