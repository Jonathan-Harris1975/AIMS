// services/rss-links/index.js
import express from "express";
import routes from "./routes/index.js";

const router = express.Router();

// Mount all rss-links routes at the service root (/rss-links/*).
router.use("/", routes);

export default router;
