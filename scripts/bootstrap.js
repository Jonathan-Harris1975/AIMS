// ============================================================
// 🧠 AI Podcast Suite — Bootstrap Sequence
// ============================================================
import "dotenv/config";

import { execFileSync } from "node:child_process";
import { log, info, debug, warn } from "../logger.js";
import { startServer } from "../server.js";

function runNodeScript(scriptPath, label, { optional = false } = {}) {
  try {
    info(`🔎 Running ${label}...`);
    execFileSync(process.execPath, [scriptPath], { stdio: "inherit" });
    info(`🟩 ${label} completed successfully.`);
    return true;
  } catch (err) {
    if (optional) {
      warn(`${label} skipped or not required.`, {
        error: err?.message || String(err),
      });
      return false;
    }
    log.error({ error: err.message }, `❌ ${label} failed`);
    process.exit(1);
  }
}

(async () => {
  debug("🧩 Starting AI-management-suite bootstrap sequence...");
  debug("---------------------------------------------");

  const hasRssStorage = Boolean(process.env.R2_BUCKET_RSS_FEEDS);
  runNodeScript(
    "./services/rss-feed-creator/startup/rss-init.js",
    "RSS Init",
    { optional: !hasRssStorage }
  );
  runNodeScript("./scripts/startupCheck.js", "Startup Check");
  runNodeScript("./scripts/tempStorage.js", "R2 Check");

  info("🚀 Launching main web server...");
  startServer();

  debug("---------------------------------------------");
  info("🏁 Bootstrap complete — server is running.");
})();
