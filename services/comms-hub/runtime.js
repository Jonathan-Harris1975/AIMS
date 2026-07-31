import { uploadText } from "../shared/utils/r2-client.js";
import { log } from "../../logger.js";
import { loadCommsHubConfig, getCommsHubReadiness } from "./config.js";
import { D1Client } from "./clients/d1Client.js";
import { JotformClient } from "./clients/jotformClient.js";
import { ZernioInboxClient } from "./clients/zernioInboxClient.js";
import { CommsHubRepository } from "./repositories/commsRepository.js";
import { CommsHubArchiveWorker } from "./workers/archiveWorker.js";
import { CommsHubSocialPollWorker } from "./workers/socialPollWorker.js";
import { safeErrorLog } from "./domain/redaction.js";

let context = null;
let runtimeState = { status: "idle", ready: false, detail: "not_started" };

export function createCommsHubContext({ env = process.env, fetchImpl, r2UploadText = uploadText } = {}) {
  const config = loadCommsHubConfig(env, { requireEnabled: true });
  const d1 = new D1Client(config, fetchImpl ? { fetchImpl } : undefined);
  const jotform = new JotformClient(config, fetchImpl ? { fetchImpl } : undefined);
  const zernio = Object.fromEntries(
    Object.entries(config.zernioFamilies)
      .filter(([, family]) => family.enabled)
      .map(([family]) => [family, new ZernioInboxClient(config, family, fetchImpl ? { fetchImpl } : undefined)])
  );
  const repository = new CommsHubRepository(d1);
  const archiveWorker = new CommsHubArchiveWorker({ repository, uploadText: r2UploadText, config });
  const socialPollWorker = new CommsHubSocialPollWorker({ repository, zernio, config });
  return Object.freeze({ config, d1, jotform, zernio: Object.freeze(zernio), repository, archiveWorker, socialPollWorker });
}

export function getCommsHubContext() {
  if (!context) context = createCommsHubContext();
  return context;
}

export function getCommsHubRuntimeReadiness() {
  const configuration = getCommsHubReadiness();
  if (!configuration.enabled) return { status: "disabled", ready: true, detail: "service_disabled" };
  if (!configuration.ready) return { status: "misconfigured", ready: false, detail: "missing_environment" };
  return { ...runtimeState };
}

export async function startCommsHubRuntime() {
  const readiness = getCommsHubReadiness();
  if (!readiness.enabled) {
    runtimeState = { status: "disabled", ready: true, detail: "service_disabled" };
    log.info("commsHub.runtime.disabled");
    return { started: false, reason: "disabled" };
  }
  if (!readiness.ready) {
    runtimeState = { status: "misconfigured", ready: false, detail: "missing_environment", missing: readiness.missing };
    log.error("commsHub.runtime.misconfigured", { missing: readiness.missing });
    return { started: false, reason: "misconfigured", missing: readiness.missing };
  }

  runtimeState = { status: "starting", ready: false, detail: "checking_schema" };
  try {
    const active = getCommsHubContext();
    const schema = await active.repository.schemaStatus();
    if (!schema.available) {
      runtimeState = { status: "schema_missing", ready: false, detail: "run_npm_comms_migrate" };
      log.error("commsHub.runtime.schemaMissing", { action: "npm run comms:migrate", missing: schema.missing || [] });
      return { started: false, reason: "schema_missing" };
    }
    const archiveWorkerStarted = active.archiveWorker.start();
    const socialPollWorkerStarted = active.socialPollWorker.start();
    runtimeState = {
      status: "ready",
      ready: true,
      detail: socialPollWorkerStarted
        ? "archive_and_social_workers_started"
        : archiveWorkerStarted ? "archive_worker_started" : "workers_disabled",
      workers: { archive: archiveWorkerStarted, socialPoll: socialPollWorkerStarted },
    };
    log.info("commsHub.runtime.started", {
      archiveWorkerStarted,
      socialPollWorkerStarted,
      forms: readiness.forms,
      zernio: Object.fromEntries(Object.entries(readiness.zernio).map(([family, state]) => [family, state.status])),
    });
    return { started: true, archiveWorkerStarted, socialPollWorkerStarted };
  } catch (error) {
    runtimeState = { status: "failed", ready: false, detail: error?.code || error?.name || "runtime_start_failed" };
    log.error("commsHub.runtime.startFailed", { error: safeErrorLog(error) });
    return { started: false, reason: "failed" };
  }
}

export async function stopCommsHubRuntime() {
  if (context) {
    await Promise.all([context.archiveWorker.stop(), context.socialPollWorker.stop()]);
  }
  context = null;
  runtimeState = { status: "stopped", ready: false, detail: "runtime_stopped" };
}

export function kickCommsHubArchiveDrain() {
  if (!context || !context.config.archiveWorkerEnabled || runtimeState.status !== "ready") return false;
  queueMicrotask(() => {
    void context.archiveWorker.runOnce().catch((error) => {
      log.error("commsHub.archive.kickFailed", { error: safeErrorLog(error) });
    });
  });
  return true;
}

export function kickCommsHubSocialPoll() {
  if (!context || !context.config.socialPollWorkerEnabled || runtimeState.status !== "ready") return false;
  queueMicrotask(() => {
    void context.socialPollWorker.runOnce().catch((error) => {
      log.error("commsHub.socialPoll.kickFailed", { error: safeErrorLog(error) });
    });
  });
  return true;
}

export function resetCommsHubRuntimeForTests() {
  context = null;
  runtimeState = { status: "idle", ready: false, detail: "not_started" };
}
