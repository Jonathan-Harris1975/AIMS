import "dotenv/config";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { info, debug, warn, error } from "../logger.js";

const STEP_TIMEOUT_MS = Number(process.env.BOOTSTRAP_STEP_TIMEOUT_MS) || 120_000;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function shouldRunRssInitOnBoot() {
  return parseBoolean(process.env.RSS_INIT_ON_BOOT, true);
}

function isRssInitRequiredBeforeListen() {
  return parseBoolean(process.env.RSS_INIT_REQUIRED_ON_BOOT, false);
}

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
  const runRssInitOnBoot = shouldRunRssInitOnBoot() && hasRssStorage;
  const rssInitRequiredBeforeListen = runRssInitOnBoot && isRssInitRequiredBeforeListen();

  if (rssInitRequiredBeforeListen) {
    await runNodeScript("./services/rss-feed-creator/startup/rss-init.js", "RSS Init", {
      optional: false,
    });
  } else if (!hasRssStorage) {
    warn("bootstrap.rss_init.skipped", {
      reason: "R2_BUCKET_RSS_FEEDS not configured",
    });
  }

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
  const server = startServer();
  if (!server.listening) {
    await Promise.race([
      once(server, "listening"),
      once(server, "error").then(([err]) => {
        throw err;
      }),
    ]);
  }

  if (runRssInitOnBoot && !rssInitRequiredBeforeListen) {
    runNodeScript("./services/rss-feed-creator/startup/rss-init.js", "RSS Init", {
      optional: true,
      timeoutMs: Number(process.env.RSS_INIT_POST_START_TIMEOUT_MS) || STEP_TIMEOUT_MS,
    }).catch((err) => {
      warn("bootstrap.rss_init.post_start.fail", {
        error: err?.message || String(err),
      });
    });
  }

  info("bootstrap.complete");
}

main().catch((err) => {
  error("bootstrap.fail", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
});
