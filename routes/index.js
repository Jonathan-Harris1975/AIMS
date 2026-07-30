// routes/index.js
import express from "express";
import { info, error } from "../logger.js";
import { requireAimsBearerAuth } from "../services/shared/middleware/suiteAuth.js";

// Service routes
import rssFeedRoutes from "./rss.js";
import rssRewriteRoutes from "../services/rss-feed-creator/routes/rewrite.js";
import scriptRoutes from "../services/script/routes/index.js";
import ttsRoutes from "../services/tts/routes/tts.js";
import artworkRoutes from "../services/artwork/index.js";
import podcastRoutes from "../services/podcast/index.js";
import outreachRoutes from "../services/outreach/routes/index.js";
import blogRoutes from "../services/blog/index.js";
import cloudflarePurgeRoutes from "../services/cloudflare-purge/index.js";
import zernioRoutes from "../services/zernio/index.js";
import blotatoRoutes from "../services/blotato/index.js";
import auditsRoutes from "../audits/index.js";
import rssLinksRoutes from "../services/rss-links/index.js";
import opsRoutes from "../services/ops/index.js";
import newsletterRoutes from "../services/newsletter/index.js";
import commsHubRoutes from "../services/comms-hub/index.js";

const router = express.Router();

router.use(requireAimsBearerAuth);

const rssRoutes = express.Router();
rssRoutes.use("/", rssFeedRoutes);
rssRoutes.use("/", rssRewriteRoutes);

export const routeRegistry = [
  { path: "/rss", name: "RSS", routes: rssRoutes },
  { path: "/script", name: "Script", routes: scriptRoutes },
  { path: "/tts", name: "TTS", routes: ttsRoutes },
  { path: "/artwork", name: "Artwork", routes: artworkRoutes },
  { path: "/podcast", name: "Podcast Pipeline", routes: podcastRoutes },
  { path: "/outreach", name: "Outreach", routes: outreachRoutes },
  { path: "/blog", name: "Blog", routes: blogRoutes },
  { path: "/cloudflare", name: "Cloudflare Purge", routes: cloudflarePurgeRoutes },
  { path: "/zernio", name: "Zernio Social Scheduler", routes: zernioRoutes },
  { path: "/blotato", name: "Blotato Social Video Service", routes: blotatoRoutes },
  { path: "/audits", name: "Audit Automation", routes: auditsRoutes },
  { path: "/rss-links", name: "RSS Links (URL Shortener)", routes: rssLinksRoutes },
  { path: "/ops", name: "Operational Preflight", routes: opsRoutes },
  { path: "/newsletter", name: "Newsletter Engine (AI Edge)", routes: newsletterRoutes },
  { path: "/comms-hub", name: "AIMS Comms Hub", routes: commsHubRoutes },
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
