// services/rss-links/routes/index.js
import express from "express";
import shortenRoutes from "./shorten.js";
import redirectRoutes from "./redirect.js";

const router = express.Router();

// POST /rss-links/shorten — internal link creation
router.use("/shorten", shortenRoutes);

// GET /rss-links/:key — public redirect
router.use("/", redirectRoutes);

export default router;
