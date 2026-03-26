import { endToEndRewrite } from "../rewrite-pipeline.js";
import { info, error } from "../../../logger.js";

export function registerRssRoute(app) {
  app.post("/run-rss", (req, res) => {
    res.status(202).json({ ok: true, message: "RSS rewrite triggered" });

    setImmediate(async () => {
      try {
        info("rss.trigger.background.start");
        const result = await endToEndRewrite();
        info("rss.trigger.background.complete", { result });
      } catch (err) {
        error("rss.trigger.background.fail", { err: err?.message || String(err) });
      }
    });
  });
}

export default registerRssRoute;
