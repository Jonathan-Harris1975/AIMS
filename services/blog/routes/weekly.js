// services/blog/routes/weekly.js
import express from "express";
import { buildWeeklyBlogPost } from "../weekly/buildWeeklyBlogPost.js";

const router = express.Router();

// POST /blog/weekly/build
router.post("/build", async (req, res) => {
  const days = Number(req.body?.days || process.env.BLOG_WEEK_DAYS || 7);
  const weekId = req.body?.weekId; // optional override

  const result = await buildWeeklyBlogPost({ days, weekId });
  if (!result?.ok) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

export default router;
