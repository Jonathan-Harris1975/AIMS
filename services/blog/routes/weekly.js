// services/blog/routes/weekly.js
import express from "express";
import { buildWeeklyBlogPost } from "../weekly/buildWeeklyBlogPost.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /blog/weekly/build
router.post("/build", asyncRoute(async (req, res) => {
  const requestedDays = Number(req.body?.days || process.env.BLOG_WEEK_DAYS || 7);

  if (!Number.isFinite(requestedDays) || requestedDays <= 0 || requestedDays > 31) {
    return res.status(400).json({
      ok: false,
      error: "days must be a number between 1 and 31",
    });
  }

  const weekId = req.body?.weekId; // optional override

  const result = await buildWeeklyBlogPost({ days: requestedDays, weekId });
  if (!result?.ok) {
    return res.status(500).json(result);
  }
  return res.json(result);
}));

export default router;
