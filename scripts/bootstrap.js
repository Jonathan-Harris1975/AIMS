import "../config/loadEnv.js";
import { spawn } from "node:child_process";
import { info, debug, warn, error } from "../logger.js";

const STEP_TIMEOUT_MS = Number(process.env.BOOTSTRAP_STEP_TIMEOUT_MS) || 120_000;
const SERVER_LISTEN_TIMEOUT_MS = Number(process.env.SERVER_LISTEN_TIMEOUT_MS) || 30_000;
const RSS_INIT_POST_START_TIMEOUT_MS =
  Number(process.env.RSS_INIT_POST_START_TIMEOUT_MS) || STEP_TIMEOUT_MS;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
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

function waitForServerListening(server, timeoutMs = SERVER_LISTEN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (server?.listening) {
      resolve(true);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Server did not start listening within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      server?.off?.("listening", onListening);
      server?.off?.("error", onError);
    }

    function onListening() {
      cleanup();
      resolve(true);
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
  const startupCheckRequired = parseBoolean(process.env.STARTUP_CHECK_REQUIRED_POST_START, false);
  const startupCheckScript = process.env.STARTUP_CHECK_SCRIPT || "./scripts/startupCheck.js";
  const rssInitOnBoot = parseBoolean(process.env.RSS_INIT_ON_BOOT, false);
  const rssInitRequired = parseBoolean(process.env.RSS_INIT_REQUIRED_ON_BOOT, false);

  await runNodeScript(startupCheckScript, "Startup Check", {
    optional: !startupCheckRequired,
  });

  if (!rssInitOnBoot) {
    info("bootstrap.rss_init.skipped", { reason: "RSS_INIT_ON_BOOT=false" });
    return;
  }

  const hasRssStorage = Boolean(process.env.R2_BUCKET_RSS_FEEDS);
  await runNodeScript("./services/rss-feed-creator/startup/rss-init.js", "RSS Init", {
    optional: !rssInitRequired || !hasRssStorage,
    timeoutMs: RSS_INIT_POST_START_TIMEOUT_MS,
  });
}

async function main() {
  debug("bootstrap.start", {
    stepTimeoutMs: STEP_TIMEOUT_MS,
    serverListenTimeoutMs: SERVER_LISTEN_TIMEOUT_MS,
  });

  await runNodeScript("./scripts/tempStorage.js", "Temp Storage Check");

  info("bootstrap.server.starting");
  const { startServer } = await import("../server.js");
  const server = startServer();
  await waitForServerListening(server);
  info("bootstrap.server.listening");

  void runPostStartChecks()
    .then(() => {
      info("bootstrap.post_start.complete");
    })
    .catch((err) => {
      error("bootstrap.post_start.fail", { error: err?.stack || err?.message || String(err) });
      if (parseBoolean(process.env.EXIT_ON_REQUIRED_POST_START_FAILURE, true)) {
        process.exit(1);
      }
      process.exitCode = 1;
    });

  // One-time migration: force-convert all plain-text transcripts to HTML.
  // Set BACKFILL_TRANSCRIPT_HTML=true in the deployment environment to trigger
  // this run, then unset (or set to false) after the deployment completes.
  if (process.env.BACKFILL_TRANSCRIPT_HTML === "true") {
    info("bootstrap.backfill.queued", { reason: "BACKFILL_TRANSCRIPT_HTML=true" });
    void runNodeScript(
      "./scripts/backfill-transcript-html.js",
      "Transcript HTML Backfill",
      { optional: true, timeoutMs: Number(process.env.BACKFILL_TRANSCRIPT_HTML_TIMEOUT_MS) || 600_000 }
    );
  }

  info("bootstrap.complete");
}

main().catch((err) => {
  error("bootstrap.fail", { error: err?.stack || err?.message || String(err) });
  process.exit(1);
});
