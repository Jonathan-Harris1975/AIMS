import express from "express";
import { rebuildBlogRssFeed } from "../rss/publishBlogRssFeed.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.post("/rebuild", asyncRoute(async (req, res) => {
  const prefix = String(process.env.BLOG_PREFIX || "blog").trim() || "blog";
  const result = await rebuildBlogRssFeed({ prefix });

  if (!result?.ok) {
    return res.status(500).json(result);
  }

  return res.json(result);
}));

export default router;
