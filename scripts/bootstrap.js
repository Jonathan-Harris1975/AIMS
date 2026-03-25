// ============================================================
// 🧠 AI Podcast Suite — Bootstrap Sequence
// ============================================================
// Initializes supporting services and runtime checks
// before the web server starts.
// ============================================================

import { execSync } from "child_process";
import { log, info, debug } from "../logger.js";

function run(cmd, label, { optional = false } = {}) {
  try {
    info(`🔎 Running ${label}...`);
    execSync(cmd, { stdio: "inherit" });
    info(`🟩 ${label} completed successfully.`);
  } catch (err) {
    if (optional) {
      info(`⚠️ ${label} skipped or not required.`);
      return;
    }
    log.error(`❌ ${label} failed: ${err.message}`);
    process.exit(1);
  }
}

(async () => {
  debug("🧩 Starting AI-management-suite bootstrap sequence...");
  debug("---------------------------------------------");

  // 1️⃣ Initialize RSS feed data into R2 (critical)
  run(
    "node ./services/rss-feed-creator/startup/rss-init.js",
    "RSS Init"
  );

  // 2️⃣ Perform runtime sanity checks
  run("node ./scripts/startupCheck.js", "Startup Check");

  // 3️⃣ Validate temp storage + Cloudflare R2 connectivity
  run("node ./scripts/tempStorage.js", "R2 Check");

  // 4️⃣ Launch the main web server
  run("node ./server.js", "Start Server");

  debug("---------------------------------------------");
  info("🏁 Bootstrap complete — container entering idle mode.");
})();
