// services/rss-feed-creator/startup/rss-init.js
import { ensureR2Sources } from "../utils/rss-bootstrap.js";
import { info, error, debug, warn } from "../../../logger.js";

(async () => {
  try {
    if (!process.env.R2_BUCKET_RSS_FEEDS) {
      warn("rss.init.skipped", {
        reason: "R2_BUCKET_RSS_FEEDS not configured",
      });
      return;
    }

    debug("🧠 RSS Init — Ensuring feeds and URLs exist in R2...");
    await ensureR2Sources();
    info("🟩 RSS Init complete.");
  } catch (err) {
    error("💥 RSS Init failed", { err: err.message });
    process.exitCode = 1;
  }
})();
