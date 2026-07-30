import { uploadText } from "../shared/utils/r2-client.js";
import { log } from "../../logger.js";
import { loadCommsHubConfig, getCommsHubReadiness } from "./config.js";
import { D1Client } from "./clients/d1Client.js";
import { JotformClient } from "./clients/jotformClient.js";
import { CommsHubRepository } from "./repositories/commsRepository.js";
import { CommsHubArchiveWorker } from "./workers/archiveWorker.js";
import { safeErrorLog } from "./domain/redaction.js";

let context = null;
let runtimeState = { status: "idle", ready: false, detail: "not_started" };

export function createCommsHubContext({ env = process.env, fetchImpl, r2UploadText = uploadText } = {}) {
  const config = loadCommsHubConfig(env, { requireEnabled: true });
  const d1 = new D1Client(config, fetchImpl ? { fetchImpl } : undefined);
  const jotform = new JotformClient(config, fetchImpl ? { fetchImpl } : undefined);
  const repository = new CommsHubRepository(d1);
  const archiveWorker = new CommsHubArchiveWorker({ repository, uploadText: r2UploadText, config });
  return Object.freeze({ config, d1, jotform, repository, archiveWorker });
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
    const workerStarted = active.archiveWorker.start();
    runtimeState = { status: "ready", ready: true, detail: workerStarted ? "worker_started" : "worker_disabled" };
    log.info("commsHub.runtime.started", { workerStarted, forms: readiness.forms });
    return { started: true, workerStarted };
  } catch (error) {
    runtimeState = { status: "failed", ready: false, detail: error?.code || error?.name || "runtime_start_failed" };
    log.error("commsHub.runtime.startFailed", { error: safeErrorLog(error) });
    return { started: false, reason: "failed" };
  }
}

export async function stopCommsHubRuntime() {
  if (context) await context.archiveWorker.stop();
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

export function resetCommsHubRuntimeForTests() {
  context = null;
  runtimeState = { status: "idle", ready: false, detail: "not_started" };
}
