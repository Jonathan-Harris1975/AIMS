// ============================================================
// 🧠 AI Podcast Suite — Bootstrap Sequence
// ============================================================
import "dotenv/config";

import { execFileSync } from "node:child_process";
import { log, info, debug } from "../logger.js";

function runNodeScript(scriptPath, label, { optional = false } = {}) {
  try {
    info(`🔎 Running ${label}...`);
    execFileSync(process.execPath, [scriptPath], { stdio: "inherit" });
    info(`🟩 ${label} completed successfully.`);
  } catch (err) {
    if (optional) {
      info(`⚠️ ${label} skipped or not required.`);
      return;
    }
    log.error({ error: err.message }, `❌ ${label} failed`);
    process.exit(1);
  }
}

(async () => {
  debug("🧩 Starting AI-management-suite bootstrap sequence...");
  debug("---------------------------------------------");

  runNodeScript("./services/rss-feed-creator/startup/rss-init.js", "RSS Init");
  runNodeScript("./scripts/startupCheck.js", "Startup Check");
  runNodeScript("./scripts/tempStorage.js", "R2 Check");

  info("🚀 Launching main web server...");
  await import("../server.js");

  debug("---------------------------------------------");
  info("🏁 Bootstrap complete — server is running.");
})();
