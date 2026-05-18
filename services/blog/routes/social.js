import express from "express";
import { buildDailySocialBlogPost } from "../social/buildDailySocialBlogPost.js";
import { rebuildSocialBlogRssFeed } from "../social/publishSocialBlogRssFeed.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { validateBody, blogSocialDailyBuildBodySchema } from "../../shared/utils/requestSchemas.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// POST /blog/social/daily/build
router.post("/daily/build", hookdeckDedupe("blog:socialDailyBuild"), asyncRoute(async (req, res) => {
  const parsed = validateBody(blogSocialDailyBuildBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
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
