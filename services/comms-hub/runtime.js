import { log } from "../../logger.js";
import { loadCommsHubConfig, getCommsHubReadiness, SOCIAL_CHANNEL_CAPABILITIES } from "./config.js";
import { D1Client } from "./clients/d1Client.js";
import { JotformClient } from "./clients/jotformClient.js";
import { ZernioInboxClient } from "./clients/zernioInboxClient.js";
import { AiSearchClient } from "./clients/aiSearchClient.js";
import { PrivateR2Client } from "./clients/privateR2Client.js";
import { CloudflareBackupClient } from "./clients/cloudflareBackupClient.js";
import { OneComMailClient } from "./clients/oneComMailClient.js";
import { CoginPalClient } from "./clients/coginPalClient.js";
import { MalwareScannerClient } from "./clients/malwareScannerClient.js";
import { CommsHubRepository } from "./repositories/commsRepository.js";
import { CommsAiRepository } from "./repositories/commsAiRepository.js";
import { CommsOperationsRepository } from "./repositories/commsOperationsRepository.js";
import { CommsHubArchiveWorker } from "./workers/archiveWorker.js";
import { CommsHubSocialPollWorker } from "./workers/socialPollWorker.js";
import { CommsHubFollowUpWorker } from "./workers/followUpWorker.js";
import { CommsHubProviderHealthWorker } from "./workers/providerHealthWorker.js";
import { CommsHubBackupWorker } from "./workers/backupWorker.js";
import { CommsHubEmailPollWorker } from "./workers/emailPollWorker.js";
import { CommsHubDelayedActionWorker } from "./workers/delayedActionWorker.js";
import { CommsHubRetentionWorker } from "./workers/retentionWorker.js";
import { CommsHubMonthEndConversationArchiveWorker } from "./workers/monthEndConversationArchiveWorker.js";
import { CommsHubWebhookReconcileWorker } from "./workers/webhookReconcileWorker.js";
import { CommsHubAiWorkflowService } from "./aiWorkflowService.js";
import { PodcastContributionWorkflowService } from "./podcastWorkflowService.js";
import { CommsHubProviderHealthService } from "./providerHealthService.js";
import { CommsHubBackupService } from "./backupService.js";
import { CommsHubAuditService } from "./auditService.js";
import { CommsHubNotificationService } from "./notificationService.js";
import { CommsHubOperationsService } from "./operationsService.js";
import { CommsHubWorkflowEngineService } from "./workflowEngineService.js";
import { CommsHubAttachmentService } from "./attachmentService.js";
import { CommsHubEmailService } from "./emailService.js";
import { CommsHubChatService } from "./chatService.js";
import { CommsHubReplyDeliveryService } from "./replyDeliveryService.js";
import { CommsHubFormProcessingService } from "./formProcessingService.js";
import { CommsHubContentAutomationService } from "./contentAutomationService.js";
import { CommsHubGovernanceService } from "./governanceService.js";
import { CommsHubCredentialVaultService } from "./credentialVaultService.js";
import { CommsHubQuarantineService } from "./quarantineService.js";
import { CommsHubMetricsService } from "./metricsService.js";
import { OutreachAutomationService } from "../outreach/services/automationService.js";
import { safeErrorLog } from "./domain/redaction.js";
import { recoverCommsHubSchema } from "./migrations/schemaRecovery.js";

let context = null;
let runtimeState = { status: "idle", ready: false, detail: "not_started" };
let runtimeStartPromise = null;
let runtimeSupervisorTimer = null;
let runtimeFailureCount = 0;

function clearRuntimeSupervisorTimer() {
  if (runtimeSupervisorTimer) clearTimeout(runtimeSupervisorTimer);
  runtimeSupervisorTimer = null;
}

function scheduleRuntimeSupervisorRetry(active, reason) {
  if (!active?.config?.runtimeSupervisorEnabled || runtimeSupervisorTimer) return false;
  runtimeFailureCount += 1;
  const base = active.config.runtimeSupervisorRetryMs;
  const maximum = active.config.runtimeSupervisorMaxRetryMs;
  const delayMs = Math.min(maximum, base * (2 ** Math.min(runtimeFailureCount - 1, 5)));
  runtimeState = { ...runtimeState, retryScheduled: true, retryInMs: delayMs, failureCount: runtimeFailureCount };
  runtimeSupervisorTimer = setTimeout(() => {
    runtimeSupervisorTimer = null;
    void startCommsHubRuntime().catch((error) => {
      log.error("commsHub.runtime.supervisorUnhandled", { error: safeErrorLog(error) });
    });
  }, delayMs);
  runtimeSupervisorTimer.unref?.();
  log.warn("commsHub.runtime.retryScheduled", { reason, delayMs, failureCount: runtimeFailureCount });
  return true;
}

export function createCommsHubContext({ env = process.env, fetchImpl, r2ArchiveStore = null } = {}) {
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
  const operationsRepository = new CommsOperationsRepository(d1);
  const primaryR2 = r2ArchiveStore || new PrivateR2Client({ ...config, r2PrivateBucketName: config.r2BucketName });
  const privateR2 = config.r2PrivateBucketName ? new PrivateR2Client(config) : null;
  const sourceR2 = config.backupEnabled ? primaryR2 : null;
  const backupR2 = config.backupEnabled ? new PrivateR2Client(config) : null;
  const restoreR2 = config.backupEnabled
    ? new PrivateR2Client({ ...config, r2PrivateBucketName: config.r2RestoreBucketName })
    : null;
  const oneComMailAccounts = Object.freeze(Object.fromEntries(
    Object.entries(config.emailAccounts || {})
      .filter(([, account]) => account.enabled)
      .map(([key, account]) => [key, new OneComMailClient({
        ...config,
        oneComEmailAccountKey: account.key,
        oneComEmailAddress: account.address,
        oneComEmailUsername: account.username,
        oneComEmailPassword: account.password,
        oneComMailbox: account.mailbox,
      })])
  ));
  const active = {
    config,
    d1,
    jotform,
    zernio: Object.freeze(zernio),
    repository,
    aiRepository,
    operationsRepository,
    aiSearch: new AiSearchClient(config, fetchImpl ? { fetchImpl } : undefined),
    primaryR2,
    privateR2,
    sourceR2,
    backupR2,
    restoreR2,
    backupClient: config.backupEnabled ? new CloudflareBackupClient(config, fetchImpl ? { fetchImpl } : undefined) : null,
    oneComMailAccounts,
    oneComMail: oneComMailAccounts.info || new OneComMailClient(config),
    coginPal: new CoginPalClient(config, fetchImpl ? { fetchImpl } : undefined),
    malwareScanner: new MalwareScannerClient(config, fetchImpl ? { fetchImpl } : undefined),
  };
  active.auditService = new CommsHubAuditService({ repository: operationsRepository });
  active.notificationService = new CommsHubNotificationService({ context: active });
  active.operationsService = new CommsHubOperationsService({ context: active });
  active.workflowEngineService = new CommsHubWorkflowEngineService({ context: active });
  active.attachmentService = new CommsHubAttachmentService({ context: active, ...(fetchImpl ? { fetchImpl } : {}) });
  active.emailService = new CommsHubEmailService({ context: active });
  active.chatService = new CommsHubChatService({ context: active });
  active.replyDelivery = new CommsHubReplyDeliveryService({ context: active });
  active.formProcessingService = new CommsHubFormProcessingService({ context: active });
  active.contentAutomationService = new CommsHubContentAutomationService({ context: active });
  active.governanceService = new CommsHubGovernanceService({ context: active });
  active.credentialVaultService = new CommsHubCredentialVaultService({ context: active });
  active.quarantineService = new CommsHubQuarantineService({ context: active });
  active.metricsService = new CommsHubMetricsService({ context: active });
  active.outreachAutomationService = new OutreachAutomationService({ context: active });
  active.archiveWorker = new CommsHubArchiveWorker({ repository, objectStore: primaryR2, config });
  active.socialPollWorker = new CommsHubSocialPollWorker({ context: active });
  active.aiWorkflowService = new CommsHubAiWorkflowService({ context: active });
  active.podcastWorkflowService = new PodcastContributionWorkflowService({ context: active });
  active.providerHealthService = new CommsHubProviderHealthService({ context: active });
  active.backupService = new CommsHubBackupService({ context: active });
  active.followUpWorker = new CommsHubFollowUpWorker({ context: active });
  active.providerHealthWorker = new CommsHubProviderHealthWorker({ context: active });
  active.backupWorker = new CommsHubBackupWorker({ context: active });
  active.emailPollWorkers = Object.freeze(Object.fromEntries(
    Object.keys(oneComMailAccounts).map((accountKey) => [accountKey, new CommsHubEmailPollWorker({ context: active, accountKey })])
  ));
  active.emailPollWorker = active.emailPollWorkers.info || Object.values(active.emailPollWorkers)[0] || null;
  active.delayedActionWorker = new CommsHubDelayedActionWorker({ context: active });
  active.retentionWorker = new CommsHubRetentionWorker({ context: active });
  active.monthEndConversationArchiveWorker = new CommsHubMonthEndConversationArchiveWorker({ context: active });
  active.webhookReconcileWorker = new CommsHubWebhookReconcileWorker({ context: active });
  active.quarantineService.register('email_poll', (item) => {
    const accountKey = String(item.source_id || '').split(':')[0];
    const worker = active.emailPollWorkers[accountKey];
    if (!worker) throw new Error(`No email poll worker is configured for ${accountKey || 'unknown'}.`);
    return worker.replay(item.source_id);
  });
  active.quarantineService.register('delayed_action', (item) => active.delayedActionWorker.replay(item.source_id));
  active.quarantineService.register('retention_job', (item) => active.retentionWorker.replay(item.source_id));
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
  if (runtimeState.ready) return { started: true, alreadyStarted: true, runtime: { ...runtimeState } };
  if (runtimeStartPromise) return runtimeStartPromise;

  runtimeStartPromise = (async () => {
    const readiness = getCommsHubReadiness();
    if (!readiness.enabled) {
      clearRuntimeSupervisorTimer();
      runtimeState = { status: "disabled", ready: true, detail: "service_disabled" };
      log.info("commsHub.runtime.disabled");
      return { started: false, reason: "disabled" };
    }
    if (!readiness.ready) {
      clearRuntimeSupervisorTimer();
      runtimeState = { status: "misconfigured", ready: false, detail: "missing_environment", missing: readiness.missing };
      log.error("commsHub.runtime.misconfigured", { missing: readiness.missing });
      return { started: false, reason: "misconfigured", missing: readiness.missing };
    }

    runtimeState = { status: "starting", ready: false, detail: "checking_schema" };
    let active;
    try {
      active = getCommsHubContext();
      const recovery = await recoverCommsHubSchema({
        repository: active.repository,
        autoMigrateOnStart: active.config.autoMigrateOnStart,
        env: process.env,
        onMigrationStart: async (schema) => {
          runtimeState = { status: "migrating", ready: false, detail: "auto_migrating_schema", missing: schema.missing || [] };
          log.warn("commsHub.runtime.autoMigration.start", { missing: schema.missing || [] });
        },
      });
      const schema = recovery.schema;
      if (recovery.migration && schema.available) {
        log.info("commsHub.runtime.autoMigration.complete", {
          applied: recovery.migration.applied || 0,
          appliedVersions: recovery.migration.appliedVersions || [],
        });
      }
      if (!schema.available) {
        runtimeState = {
          status: "schema_missing",
          ready: false,
          detail: active.config.autoMigrateOnStart ? "auto_migration_incomplete" : "auto_migration_disabled",
          missing: schema.missing || [],
        };
        log.error("commsHub.runtime.schemaMissing", {
          autoMigrateOnStart: active.config.autoMigrateOnStart,
          missing: schema.missing || [],
        });
        if (active.config.autoMigrateOnStart) scheduleRuntimeSupervisorRetry(active, "schema_missing");
        return { started: false, reason: "schema_missing", missing: schema.missing || [] };
      }

      if (active.config.backupEnabled) {
        runtimeState = { status: "starting", ready: false, detail: "ensuring_restore_database" };
        const restoreDatabase = await active.backupClient.ensureRestoreDatabase();
        log.info("commsHub.runtime.restoreDatabaseReady", {
          name: restoreDatabase.name,
          created: restoreDatabase.created,
          source: restoreDatabase.source,
        });
      }

      const archiveWorkerStarted = active.archiveWorker.start();
      const socialPollWorkerStarted = active.socialPollWorker.start();
      const webhookReconcileWorkerStarted = active.webhookReconcileWorker.start();
      const followUpWorkerStarted = active.followUpWorker.start();
      const providerHealthWorkerStarted = active.providerHealthWorker.start();
      const backupWorkerStarted = active.backupWorker.start();
      const emailPollWorkerStarted = Object.fromEntries(Object.entries(active.emailPollWorkers).map(([key, worker]) => [key, worker.start()]));
      const delayedActionWorkerStarted = active.delayedActionWorker.start();
      const retentionWorkerStarted = active.retentionWorker.start();
      const monthEndConversationArchiveWorkerStarted = active.monthEndConversationArchiveWorker.start();
      clearRuntimeSupervisorTimer();
      runtimeFailureCount = 0;
      runtimeState = {
        status: "ready",
        ready: true,
        detail: "configured_workers_started",
        workers: {
          archive: archiveWorkerStarted,
          socialPoll: socialPollWorkerStarted,
          webhookReconcile: webhookReconcileWorkerStarted,
          followUp: followUpWorkerStarted,
          providerHealth: providerHealthWorkerStarted,
          backup: backupWorkerStarted,
          emailPoll: emailPollWorkerStarted,
          delayedActions: delayedActionWorkerStarted,
          retention: retentionWorkerStarted,
          monthEndConversationArchive: monthEndConversationArchiveWorkerStarted,
        },
      };
      log.info("commsHub.runtime.started", {
        archiveWorkerStarted,
        socialPollWorkerStarted,
        webhookReconcileWorkerStarted,
        followUpWorkerStarted,
        providerHealthWorkerStarted,
        backupWorkerStarted,
        emailPollWorkerStarted,
        delayedActionWorkerStarted,
        retentionWorkerStarted,
        monthEndConversationArchiveWorkerStarted,
        forms: readiness.forms,
        email: {
          enabled: active.config.emailEnabled,
          pollWorkerEnabled: active.config.emailPollWorkerEnabled,
          imapHost: active.config.oneComImapHost,
          imapPort: active.config.oneComImapPort,
          historicalBackfillEnabled: active.config.emailHistoricalBackfillEnabled,
          accounts: Object.fromEntries(Object.entries(active.config.emailAccounts || {}).map(([key, account]) => [key, {
            enabled: account.enabled,
            address: account.address,
            mailbox: account.mailbox,
            manualOnly: account.manualOnly,
            workflowEvaluationEnabled: account.workflowEvaluationEnabled,
            passwordConfigured: Boolean(account.password),
            workerStarted: emailPollWorkerStarted[key] === true,
          }])),
        },
        chat: {
          enabled: active.config.chatEnabled,
          provider: "coginpal",
          transport: active.config.coginPalApiBaseUrl ? "provider_api" : "aims_first_party",
          webhookSecretConfigured: Boolean(active.config.coginPalWebhookSecret),
          aiWorkflowEnabled: active.config.chatAiWorkflowEnabled,
          maxMessageChars: active.config.chatMaxMessageChars,
          maxMessagesPerMinute: active.config.chatMaxMessagesPerMinute,
        },
        zernio: Object.fromEntries(Object.entries(readiness.zernio).map(([family, state]) => [family, state.status])),
        socialMonitoring: {
          monitorOnly: active.config.socialMonitorOnly,
          pollWorkerEnabled: active.config.socialPollWorkerEnabled,
          pollMs: active.config.socialPollMs,
          batchSize: active.config.socialPollBatchSize,
          webhookReconcileEnabled: active.config.zernioWebhookReconcileEnabled,
          webhookReconcileIntervalMs: active.config.zernioWebhookReconcileIntervalMs,
          enabledFamilies: active.socialPollWorker.enabledFamilies(),
          platforms: Object.fromEntries(
            Object.entries(active.config.zernioFamilies)
              .filter(([, family]) => family.enabled)
              .map(([familyName, family]) => [familyName, [...family.platforms]])
          ),
          channels: Object.fromEntries(
            Object.entries(SOCIAL_CHANNEL_CAPABILITIES).map(([platform, capabilities]) => [platform, {
              family: capabilities.family,
              enabled: active.config.zernioFamilies?.[capabilities.family]?.enabled === true,
              directMessages: capabilities.directMessages,
              comments: capabilities.comments,
              pollingResources: [...capabilities.pollingResources],
            }])
          ),
        },
      });
      return { started: true, archiveWorkerStarted, socialPollWorkerStarted, webhookReconcileWorkerStarted, followUpWorkerStarted, providerHealthWorkerStarted, backupWorkerStarted, emailPollWorkerStarted, delayedActionWorkerStarted, retentionWorkerStarted, monthEndConversationArchiveWorkerStarted };
    } catch (error) {
      runtimeState = { status: "failed", ready: false, detail: error?.code || error?.name || "runtime_start_failed" };
      log.error("commsHub.runtime.startFailed", { error: safeErrorLog(error) });
      if (active) scheduleRuntimeSupervisorRetry(active, error?.code || error?.name || "runtime_start_failed");
      return { started: false, reason: "failed" };
    }
  })();

  try {
    return await runtimeStartPromise;
  } finally {
    runtimeStartPromise = null;
  }
}

export async function stopCommsHubRuntime() {
  clearRuntimeSupervisorTimer();
  runtimeFailureCount = 0;
  if (context) {
    await Promise.all([
      context.archiveWorker.stop(),
      context.socialPollWorker.stop(),
      context.webhookReconcileWorker.stop(),
      context.followUpWorker.stop(),
      context.providerHealthWorker.stop(),
      context.backupWorker.stop(),
      ...Object.values(context.emailPollWorkers || {}).map((worker) => worker.stop()),
      context.delayedActionWorker.stop(),
      context.retentionWorker.stop(),
      context.monthEndConversationArchiveWorker.stop(),
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
  clearRuntimeSupervisorTimer();
  runtimeStartPromise = null;
  runtimeFailureCount = 0;
  context = null;
  runtimeState = { status: "idle", ready: false, detail: "not_started" };
}
