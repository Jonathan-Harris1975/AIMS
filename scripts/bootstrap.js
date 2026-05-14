import "dotenv/config";
import { spawn } from "node:child_process";
import { info, debug, warn, error } from "../logger.js";

const STEP_TIMEOUT_MS = Number(process.env.BOOTSTRAP_STEP_TIMEOUT_MS) || 120_000;
const POST_START_STEP_TIMEOUT_MS = Number(process.env.BOOTSTRAP_POST_START_STEP_TIMEOUT_MS) || STEP_TIMEOUT_MS;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalised)) return true;
  if (["0", "false", "no", "off"].includes(normalised)) return false;
  return fallback;
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

function waitForListening(server, timeoutMs = Number(process.env.BOOTSTRAP_LISTEN_TIMEOUT_MS) || 30_000) {
  if (server?.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Server did not begin listening within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      server?.off?.("listening", onListening);
      server?.off?.("error", onError);
    }

    function onListening() {
      cleanup();
      resolve();
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

async function runPostStartChecks() {
  const startupCheckRequired = parseBoolean(process.env.STARTUP_CHECK_REQUIRED_ON_BOOT, false);
  await runNodeScript("./scripts/startupCheck.js", "Startup Check", {
    optional: !startupCheckRequired,
    timeoutMs: POST_START_STEP_TIMEOUT_MS,
  });

  const rssInitEnabled = parseBoolean(process.env.RSS_INIT_ON_BOOT, true);
  if (rssInitEnabled) {
    const rssInitRequired = parseBoolean(process.env.RSS_INIT_REQUIRED_ON_BOOT, false);
    await runNodeScript("./services/rss-feed-creator/startup/rss-init.js", "RSS Init", {
      optional: !rssInitRequired,
      timeoutMs: Number(process.env.RSS_INIT_POST_START_TIMEOUT_MS) || POST_START_STEP_TIMEOUT_MS,
    });
  } else {
    info("bootstrap.step.skipped", { label: "RSS Init", reason: "RSS_INIT_ON_BOOT=false" });
  }

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
}

async function main() {
  debug("bootstrap.start", {
    stepTimeoutMs: STEP_TIMEOUT_MS,
    postStartStepTimeoutMs: POST_START_STEP_TIMEOUT_MS,
  });

  await runNodeScript("./scripts/tempStorage.js", "Temp Storage Check", {
    optional: false,
    timeoutMs: Math.min(STEP_TIMEOUT_MS, 30_000),
  });

  info("bootstrap.server.starting");
  const { startServer } = await import("../server.js");
  const server = startServer();
  await waitForListening(server);
  info("bootstrap.server.listening", {
    port: process.env.PORT || 3000,
    postStartChecks: "scheduled",
  });

  runPostStartChecks()
    .then(() => info("bootstrap.post_start.complete"))
    .catch((err) => {
      error("bootstrap.post_start.fail", { error: err?.stack || err?.message || String(err) });
      if (parseBoolean(process.env.BOOTSTRAP_POST_START_FAILS_PROCESS, false)) {
        process.exit(1);
      }
    });

  info("bootstrap.complete");
}

main().catch((err) => {
  error("bootstrap.fail", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
});
