// services/blog/routes/index.js
import express from "express";
import weeklyRoutes from "./weekly.js";
import rssRoutes from "./rss.js";

const router = express.Router();

router.use("/weekly", weeklyRoutes);
router.use("/rss", rssRoutes);

export default router;
