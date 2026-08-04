import { uploadText } from "../shared/utils/r2-client.js";
import { log } from "../../logger.js";
import { loadCommsHubConfig, getCommsHubReadiness } from "./config.js";
import { D1Client } from "./clients/d1Client.js";
import { JotformClient } from "./clients/jotformClient.js";
import { ZernioInboxClient } from "./clients/zernioInboxClient.js";
import { AiSearchClient } from "./clients/aiSearchClient.js";
import { PrivateR2Client } from "./clients/privateR2Client.js";
import { CloudflareBackupClient } from "./clients/cloudflareBackupClient.js";
import { CommsHubRepository } from "./repositories/commsRepository.js";
import { CommsAiRepository } from "./repositories/commsAiRepository.js";
import { CommsHubArchiveWorker } from "./workers/archiveWorker.js";
import { CommsHubSocialPollWorker } from "./workers/socialPollWorker.js";
import { CommsHubFollowUpWorker } from "./workers/followUpWorker.js";
import { CommsHubProviderHealthWorker } from "./workers/providerHealthWorker.js";
import { CommsHubBackupWorker } from "./workers/backupWorker.js";
import { CommsHubAiWorkflowService } from "./aiWorkflowService.js";
import { PodcastContributionWorkflowService } from "./podcastWorkflowService.js";
import { CommsHubProviderHealthService } from "./providerHealthService.js";
import { CommsHubBackupService } from "./backupService.js";
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
  const aiRepository = new CommsAiRepository(d1);
  const sourceR2 = config.backupEnabled
    ? new PrivateR2Client({ ...config, r2PrivateBucketName: config.r2BucketName })
    : null;
  const backupR2 = config.backupEnabled ? new PrivateR2Client(config) : null;
  const restoreR2 = config.backupEnabled
    ? new PrivateR2Client({ ...config, r2PrivateBucketName: config.r2RestoreBucketName })
    : null;
  const active = {
    config,
    d1,
    jotform,
    zernio: Object.freeze(zernio),
    repository,
    aiRepository,
    aiSearch: new AiSearchClient(config, fetchImpl ? { fetchImpl } : undefined),
    sourceR2,
    backupR2,
    restoreR2,
    backupClient: config.backupEnabled ? new CloudflareBackupClient(config, fetchImpl ? { fetchImpl } : undefined) : null,
  };
  active.archiveWorker = new CommsHubArchiveWorker({ repository, uploadText: r2UploadText, config });
  active.socialPollWorker = new CommsHubSocialPollWorker({ repository, zernio, config });
  active.aiWorkflowService = new CommsHubAiWorkflowService({ context: active });
  active.podcastWorkflowService = new PodcastContributionWorkflowService({ context: active });
  active.providerHealthService = new CommsHubProviderHealthService({ context: active });
  active.backupService = new CommsHubBackupService({ context: active });
  active.followUpWorker = new CommsHubFollowUpWorker({ context: active });
  active.providerHealthWorker = new CommsHubProviderHealthWorker({ context: active });
  active.backupWorker = new CommsHubBackupWorker({ context: active });
  return Object.freeze(active);
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
    const followUpWorkerStarted = active.followUpWorker.start();
    const providerHealthWorkerStarted = active.providerHealthWorker.start();
    const backupWorkerStarted = active.backupWorker.start();
    runtimeState = {
      status: "ready",
      ready: true,
      detail: "configured_workers_started",
      workers: {
        archive: archiveWorkerStarted,
        socialPoll: socialPollWorkerStarted,
        followUp: followUpWorkerStarted,
        providerHealth: providerHealthWorkerStarted,
        backup: backupWorkerStarted,
      },
    };
    log.info("commsHub.runtime.started", {
      archiveWorkerStarted,
      socialPollWorkerStarted,
      followUpWorkerStarted,
      providerHealthWorkerStarted,
      backupWorkerStarted,
      forms: readiness.forms,
      zernio: Object.fromEntries(Object.entries(readiness.zernio).map(([family, state]) => [family, state.status])),
    });
    return { started: true, archiveWorkerStarted, socialPollWorkerStarted, followUpWorkerStarted, providerHealthWorkerStarted, backupWorkerStarted };
  } catch (error) {
    runtimeState = { status: "failed", ready: false, detail: error?.code || error?.name || "runtime_start_failed" };
    log.error("commsHub.runtime.startFailed", { error: safeErrorLog(error) });
    return { started: false, reason: "failed" };
  }
}

export async function stopCommsHubRuntime() {
  if (context) {
    await Promise.all([
      context.archiveWorker.stop(),
      context.socialPollWorker.stop(),
      context.followUpWorker.stop(),
      context.providerHealthWorker.stop(),
      context.backupWorker.stop(),
    ]);
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
