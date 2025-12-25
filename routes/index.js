// routes/index.js
import express from "express";
import { info, error } from "../logger.js";

// Service routes
import rssRoutes from "../services/rss-feed-creator/routes/rewrite.js";
import scriptRoutes from "../services/script/routes/index.js";
import ttsRoutes from "../services/tts/routes/tts.js";
import artworkRoutes from "../services/artwork/index.js";
import podcastRoutes from "../services/podcast/index.js";
import outreachRoutes from "../services/outreach/routes/index.js";

const router = express.Router();

const routeRegistry = [
  { path: "/rss", name: "RSS Feed Creator", routes: rssRoutes },
  { path: "/script", name: "Script", routes: scriptRoutes },
  { path: "/tts", name: "TTS", routes: ttsRoutes },
  { path: "/artwork", name: "Artwork", routes: artworkRoutes },
  { path: "/podcast", name: "Podcast Pipeline", routes: podcastRoutes },
  { path: "/outreach", name: "Outreach", routes: outreachRoutes }
];

try {
  routeRegistry.forEach(({ path, name, routes }) => {
    router.use(path, routes);
    info(" ✅ Route mounted", { path, name });
  });

  info(`🟩 Routes mounted: ${routeRegistry.length} services registered`);
} catch (err) {
  error("💥 Route registration failed", { error: err.stack });
  throw err;
}

export default router;
