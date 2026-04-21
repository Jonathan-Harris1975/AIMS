import "dotenv/config";
import { spawn } from "node:child_process";
import { info, debug, warn, error } from "../logger.js";

const STEP_TIMEOUT_MS = Number(process.env.BOOTSTRAP_STEP_TIMEOUT_MS) || 120_000;

function runNodeScript(scriptPath, label, { optional = false, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    info("bootstrap.step.start", { label, scriptPath, timeoutMs, optional });

    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: process.env,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    timer.unref?.();

    child.once("error", (err) => {
      clearTimeout(timer);
      if (optional) {
        warn("bootstrap.step.optional.error", { label, error: err?.message || String(err) });
        resolve(false);
        return;
      }
      reject(err);
    });

    child.once("close", (code, signal) => {
      clearTimeout(timer);

      if (code === 0) {
        info("bootstrap.step.complete", { label, scriptPath });
        resolve(true);
        return;
      }

      const err = new Error(
        timedOut
          ? `${label} timed out after ${timeoutMs}ms`
          : `${label} exited with code ${code}${signal ? ` (signal ${signal})` : ""}`
      );

      if (optional) {
        warn("bootstrap.step.optional.skipped", { label, error: err.message });
        resolve(false);
        return;
      }

      reject(err);
    });
  });
}

async function main() {
  debug("bootstrap.start", { stepTimeoutMs: STEP_TIMEOUT_MS });

  const hasRssStorage = Boolean(process.env.R2_BUCKET_RSS_FEEDS);
  await runNodeScript("./services/rss-feed-creator/startup/rss-init.js", "RSS Init", {
    optional: !hasRssStorage,
  });
  await runNodeScript("./scripts/startupCheck.js", "Startup Check");
  await runNodeScript("./scripts/tempStorage.js", "Temp Storage Check");

  // One-time migration: force-convert all plain-text transcripts to HTML.
  // Set BACKFILL_TRANSCRIPT_HTML=true in the deployment environment to trigger
  // this run, then unset (or set to false) after the deployment completes.
  if (process.env.BACKFILL_TRANSCRIPT_HTML === "true") {
    info("bootstrap.backfill.queued", { reason: "BACKFILL_TRANSCRIPT_HTML=true" });
    await runNodeScript(
      "./scripts/backfill-transcript-html.js",
      "Transcript HTML Backfill",
      { optional: true, timeoutMs: Number(process.env.BACKFILL_TRANSCRIPT_HTML_TIMEOUT_MS) || 600_000 }
    );
  }

  info("bootstrap.server.starting");
  const { startServer } = await import("../server.js");
  startServer();
  info("bootstrap.complete");
}

main().catch((err) => {
  error("bootstrap.fail", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
});
