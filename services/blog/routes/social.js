import express from "express";
import { buildDailySocialBlogPost } from "../social/buildDailySocialBlogPost.js";
import { rebuildSocialBlogRssFeed } from "../social/publishSocialBlogRssFeed.js";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
import { validateBody, blogSocialDailyBuildBodySchema } from "../../shared/utils/requestSchemas.js";
import { getAsyncServiceRouteJobFresh, shouldRunAsyncServiceRoute, startAsyncServiceRouteJob } from "../../shared/utils/asyncServiceRouteJobs.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/jobs/:lane/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncServiceRouteJobFresh("blog-social", req.params.lane, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, service: "blog-social", error: "Blog social async job not found", lane: req.params.lane, sessionId: req.params.sessionId });
  return res.json(job);
}));

// POST /blog/social/daily/build
router.post("/daily/build", requestDedupe("blog:socialDailyBuild"), asyncRoute(async (req, res) => {
  const parsed = validateBody(blogSocialDailyBuildBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  if (shouldRunAsyncServiceRoute(req)) {
    const job = await startAsyncServiceRouteJob({
      service: "blog-social",
      lane: "daily-build",
      payload: parsed.data,
      req,
      statusBasePath: "/blog/social/jobs",
      runner: buildDailySocialBlogPost,
      metadata: { route: "/blog/social/daily/build" },
    });
    return res.status(202).json(job);
  }

  const result = await buildDailySocialBlogPost(parsed.data);
  if (!result?.ok) return res.status(result?.statusCode || 500).json(result);
  return res.json(result);
}));

// POST /blog/social/rss/rebuild
router.post("/rss/rebuild", asyncRoute(async (req, res) => {
  const prefix = String(process.env.BLOG_SOCIAL_PREFIX || "social-media-blog").trim() || "social-media-blog";
  const result = await rebuildSocialBlogRssFeed({ prefix });
  if (!result?.ok) return res.status(500).json(result);
  return res.json(result);
}));

export default router;
