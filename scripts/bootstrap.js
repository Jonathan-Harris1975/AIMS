// ============================================================
// 🧠 AI Podcast Suite — Bootstrap Sequence
// ============================================================
// Ensures env, repo hygiene, RSS, R2, and services are ready
// before the web server starts.
// ============================================================

import { execSync } from "child_process";
import { log, info, debug } from "#logger.js";
import fs from "fs";

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

// Quick static check for illegal #shared imports
function needsImportFix() {
  try {
    execSync(
      `grep -R "#shared/" services | grep -v "#shared/utils/"`,
      { stdio: "ignore" }
    );
    return true; // grep found matches
  } catch {
    return false; // no matches
  }
}

(async () => {
  debug("🧩 Starting AI-management-suite bootstrap sequence...");
  debug("---------------------------------------------");

  // 1️⃣ Load and validate environment variables
  run("node ./scripts/envBootstrap.js", "Environment Bootstrap");

  // 2️⃣ Fix illegal shared imports (only if needed)
  if (needsImportFix()) {
    run(
      "node ./scripts/fix-shared-imports.js",
      "Shared Import Auto-Fix"
    );
  } else {
    info("🟢 Shared imports already compliant — skipping fix.");
  }

  // 3️⃣ Initialize RSS feed data into R2 (critical)
  run(
    "node ./services/rss-feed-creator/startup/rss-init.js",
    "RSS Init"
  );

  // 4️⃣ Perform runtime sanity checks
  run("node ./scripts/startupCheck.js", "Startup Check");

  // 5️⃣ Validate temp storage + Cloudflare R2 connectivity
  run("node ./scripts/tempStorage.js", "R2 Check");

  // 6️⃣ Launch the main web server
  run("node ./server.js", "Start Server");

  debug("---------------------------------------------");
  info("🏁 Bootstrap complete — container entering idle mode.");
})();
