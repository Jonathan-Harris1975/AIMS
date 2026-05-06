// services/blog/routes/index.js
import express from "express";
import weeklyRoutes from "./weekly.js";
import rssRoutes from "./rss.js";
import socialRoutes from "./social.js";

const router = express.Router();

router.use("/weekly", weeklyRoutes);
router.use("/rss", rssRoutes);
router.use("/social", socialRoutes);

export default router;
