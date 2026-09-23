import { sha256Hex, stableId } from "./domain/ids.js";
import { CommsHubError } from "./errors.js";

export const COMMS_HUB_HOUSEKEEPING_CONFIRMATION = "run-comms-hub-monthly-housekeeping";

function isoBefore(at, days) {
  return new Date(at.getTime() - Number(days) * 86400000).toISOString();
}

function localDateParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function windowKey(runType, date, timeZone, dryRun) {
  const parts = localDateParts(date, timeZone);
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const period = runType === "monthly" ? `${parts.year}-${parts.month}` : dateKey;
  return `${runType}:${period}${dryRun ? ":dry-run" : ""}`;
}

function failure(error) {
  return {
    code: String(error?.code || error?.name || "housekeeping_stage_failed").slice(0, 120),
    failureClass: String(error?.failureClass || "recoverable").slice(0, 50),
    retryable: error?.retryable === true,
  };
}

export class CommsHubHousekeepingService {
  constructor({ context }) {
    this.context = context;
    this.running = false;
  }

  async notification({ type, title, bodyText, severity, idempotencySeed }) {
    const actor = this.context.config.housekeepingNotificationActor || "admin";
    return this.context.notificationService.create({
      actor,
      type,
      title,
      bodyText,
      severity,
      emailRequested: false,
      idempotencySeed,
      metadata: { source: "comms-hub-housekeeping" },
    });
  }

  async retentionPolicyHealth({ at, dryRun }) {
    const activePolicies = await this.context.housekeepingRepository.activeRetentionPolicyCount();
    if (activePolicies === 0) {
      const observedAt = at instanceof Date ? at.toISOString() : String(at || new Date().toISOString());
      if (!dryRun) {
        await this.notification({
          type: "system",
          title: "Comms Hub retention policy missing",
          bodyText: "No active Comms Hub retention policy exists. Automated retention is paused until an administrator activates one.",
          severity: "critical",
          idempotencySeed: `retention-policy-missing:${observedAt.slice(0, 10)}`,
        });
      }
      throw new CommsHubError(409, "retention_policy_missing", "No active Comms Hub retention policy exists.", {
        failureClass: "permanent",
      });
    }
    return { activePolicies, baselineAvailable: true };
  }

  async databaseJanitor({ at, dryRun }) {
    const input = {
      at: at.toISOString(),
      recordCutoff: isoBefore(at, this.context.config.housekeepingCompletedRecordDays),
    };
    const counts = dryRun
      ? await this.context.housekeepingRepository.previewDatabaseJanitor(input)
      : await this.context.housekeepingRepository.runDatabaseJanitor(input);
    return { dryRun, recordCutoff: input.recordCutoff, counts };
  }

  async archiveAuditTrail({ at, dryRun }) {
    if (!this.context.config.housekeepingAuditArchiveEnabled) return { skipped: true, reason: "disabled", archived: 0 };
    if (!this.context.privateR2) return { skipped: true, reason: "private_storage_unconfigured", archived: 0 };
    const before = isoBefore(at, this.context.config.housekeepingAuditRetentionDays);
    const events = await this.context.housekeepingRepository.listAuditEventsForArchive({
      before,
      limit: this.context.config.housekeepingAuditBatchSize,
    });
    if (!events.length || dryRun) return { dryRun, before, candidates: events.length, archived: 0 };

    const first = events[0];
    const last = events.at(-1);
    const payload = {
      schemaVersion: 1,
      archivedAt: at.toISOString(),
      firstPreviousSha256: first.chain_previous_sha256 || null,
      lastChainSha256: last.chain_sha256,
      events,
    };
    const body = JSON.stringify(payload);
    const payloadSha256 = sha256Hex(body);
    const objectKey = `audit-archive/${first.occurred_at.slice(0, 7).replace("-", "/")}/${first.id}-${last.id}-${payloadSha256.slice(0, 16)}.json`;
    const stored = await this.context.privateR2.putText(
      objectKey,
      body,
      "application/json; charset=utf-8",
      { payload_sha256: payloadSha256, last_chain_sha256: last.chain_sha256 }
    );
    if (stored.sha256 !== payloadSha256) {
      throw new CommsHubError(409, "audit_archive_checksum_mismatch", "Stored audit archive checksum did not match its payload.");
    }
    const archived = await this.context.housekeepingRepository.commitAuditArchiveSegment({
      id: stableId("aas", first.id, last.id, payloadSha256),
      objectKey,
      firstEventId: first.id,
      lastEventId: last.id,
      firstOccurredAt: first.occurred_at,
      lastOccurredAt: last.occurred_at,
      firstPreviousSha256: first.chain_previous_sha256 || null,
      lastChainSha256: last.chain_sha256,
      payloadSha256,
      archivedAt: at.toISOString(),
    }, events.map((event) => event.id));
    return { dryRun: false, before, candidates: events.length, archived, objectKey, payloadSha256 };
  }

  async telemetry({ at, dryRun, archiveAudit }) {
    const providerBefore = isoBefore(at, this.context.config.housekeepingProviderHealthDays);
    const providerHealthDeleted = await this.context.housekeepingRepository.pruneProviderHealth({
      before: providerBefore,
      dryRun,
    });
    const audit = archiveAudit
      ? await this.archiveAuditTrail({ at, dryRun })
      : { skipped: true, reason: "monthly_only", archived: 0 };
    return { dryRun, providerBefore, providerHealthDeleted, audit };
  }

  async quarantineReview({ at, dryRun = false }) {
    const olderThan = isoBefore(at, this.context.config.housekeepingQuarantineWarningDays);
    const summary = await this.context.housekeepingRepository.quarantineSummary({ olderThan });
    if (summary.olderThanCount > 0 && !dryRun) {
      await this.notification({
        type: "failure",
        title: "Comms Hub quarantine review required",
        bodyText: `${summary.olderThanCount} unresolved quarantine item(s) are older than ${this.context.config.housekeepingQuarantineWarningDays} days. They were not deleted.`,
        severity: summary.olderThanCount >= 10 ? "critical" : "warning",
        idempotencySeed: `quarantine-review:${windowKey("quarantine_review", at, this.context.config.businessTimeZone, false)}`,
      });
    }
    return { reportGenerated: true, dryRun, olderThan, ...summary, unresolvedAutoDeleted: 0 };
  }

  async reconcilePrivateStorage({ at, dryRun }) {
    if (!this.context.privateR2) return { skipped: true, reason: "private_storage_unconfigured" };
    const repositoryObjects = await this.context.housekeepingRepository.listAttachmentObjects();
    const storedObjects = [
      ...await this.context.privateR2.list("attachments/"),
      ...await this.context.privateR2.list("quarantine/attachments/"),
    ];
    const referencedKeys = new Set(repositoryObjects.map((object) => object.object_key));
    const storedKeys = new Set(storedObjects.map((object) => object.key));
    const missing = repositoryObjects.filter((object) => !storedKeys.has(object.object_key));
    const orphanBefore = isoBefore(at, this.context.config.housekeepingOrphanGraceDays);
    const orphans = storedObjects
      .filter((object) => !referencedKeys.has(object.key) && object.lastModified && object.lastModified < orphanBefore)
      .slice(0, this.context.config.housekeepingR2DeleteLimit);
    const disposable = await this.context.housekeepingRepository.listDisposableQuarantinedAttachments({
      before: isoBefore(at, this.context.config.housekeepingQuarantinedAttachmentDays),
      limit: this.context.config.housekeepingR2DeleteLimit,
    });
    const exports = await this.context.housekeepingRepository.listExpiredExports({
      before: isoBefore(at, this.context.config.housekeepingExportRetentionDays),
      limit: this.context.config.housekeepingR2DeleteLimit,
    });

    if (!dryRun) {
      for (const object of orphans) await this.context.privateR2.delete(object.key);
      for (const object of disposable) {
        await this.context.privateR2.delete(object.object_key);
        await this.context.housekeepingRepository.markAttachmentObjectDeleted({
          objectId: object.id,
          attachmentId: object.attachment_id,
          at: at.toISOString(),
        });
      }
      for (const item of exports) {
        await this.context.privateR2.delete(item.export_object_key);
        await this.context.housekeepingRepository.markExportExpired({ id: item.id, at: at.toISOString() });
      }
    }
    if (missing.length && !dryRun) {
      await this.notification({
        type: "failure",
        title: "Comms Hub attachment reconciliation warning",
        bodyText: `${missing.length} attachment catalogue record(s) point to missing private objects. No catalogue records were deleted.`,
        severity: "critical",
        idempotencySeed: `attachment-missing:${at.toISOString().slice(0, 7)}`,
      });
    }
    return {
      dryRun,
      referenced: repositoryObjects.length,
      stored: storedObjects.length,
      missing: missing.length,
      missingAttachmentIds: missing.slice(0, 50).map((object) => object.attachment_id),
      orphanCandidates: orphans.length,
      orphansDeleted: dryRun ? 0 : orphans.length,
      quarantinedCandidates: disposable.length,
      quarantinedDeleted: dryRun ? 0 : disposable.length,
      exportCandidates: exports.length,
      exportsDeleted: dryRun ? 0 : exports.length,
    };
  }

  async backupHousekeeping({ at, dryRun }) {
    if (!this.context.config.backupEnabled) return { skipped: true, reason: "backup_disabled" };
    let latest = await this.context.aiRepository.getLatestRestorableBackup();
    if (!latest && !dryRun) {
      await this.context.backupWorker.runOnce();
      latest = await this.context.aiRepository.getLatestRestorableBackup();
    }
    if (!latest) {
      if (dryRun) return { dryRun: true, restoreCandidate: null, rotations: 0, restoreObjectsExpired: 0 };
      throw new CommsHubError(409, "backup_restore_candidate_missing", "No completed backup is available for monthly restore validation.");
    }
    const rotationCandidates = await this.context.aiRepository.listBackupRunsForRotation({
      retain: this.context.config.housekeepingBackupRunsRetained,
    });
    const restoreObjects = await this.context.restoreR2.list("restore-validation/");
    const restoreBefore = isoBefore(at, this.context.config.housekeepingRestoreObjectDays);
    const expiredRestoreObjects = restoreObjects.filter((object) => object.lastModified && object.lastModified < restoreBefore);
    if (dryRun) {
      return {
        dryRun: true,
        restoreCandidate: latest.id,
        rotations: rotationCandidates.length,
        restoreObjectsExpired: expiredRestoreObjects.length,
      };
    }

    const validation = await this.context.backupService.validateRestore(latest.id, {
      actor: "aims:monthly-housekeeping",
      resetTarget: true,
    });
    let backupObjectsDeleted = 0;
    let backupRunsDeleted = 0;
    for (const run of rotationCandidates) {
      const manifestKey = String(run.r2_manifest_key || "");
      const prefix = manifestKey.endsWith("/manifest.json") ? manifestKey.slice(0, -"manifest.json".length) : "";
      if (prefix.startsWith("backups/")) {
        const objects = await this.context.backupR2.list(prefix);
        for (const object of objects) {
          await this.context.backupR2.delete(object.key);
          backupObjectsDeleted += 1;
        }
      }
      const removed = await this.context.aiRepository.deleteBackupRun(run.id);
      backupRunsDeleted += removed.runs;
    }
    for (const object of expiredRestoreObjects) await this.context.restoreR2.delete(object.key);
    return {
      dryRun: false,
      restoreCandidate: latest.id,
      validation,
      backupRunsDeleted,
      backupObjectsDeleted,
      restoreObjectsDeleted: expiredRestoreObjects.length,
    };
  }

  stagesFor(runType) {
    if (runType === "quarantine_review") return ["quarantine_review"];
    if (runType === "daily") return ["retention_policy_health", "database_janitor", "telemetry"];
    return [
      "retention_policy_health",
      "database_janitor",
      "quarantine_review",
      "private_storage_reconciliation",
      "telemetry",
      "backup_restore_and_rotation",
      "info_mailbox_archive",
    ];
  }

  async executeStage(name, input) {
    if (name === "retention_policy_health") return this.retentionPolicyHealth(input);
    if (name === "database_janitor") return this.databaseJanitor(input);
    if (name === "quarantine_review") return this.quarantineReview(input);
    if (name === "private_storage_reconciliation") return this.reconcilePrivateStorage(input);
    if (name === "telemetry") return this.telemetry({ ...input, archiveAudit: input.runType !== "daily" });
    if (name === "backup_restore_and_rotation") return this.backupHousekeeping(input);
    if (name === "info_mailbox_archive") return this.context.emailArchiveService.run(input);
    throw new TypeError(`Unsupported housekeeping stage: ${name}`);
  }

  async run({ runType = "daily", actor = "aims:housekeeping", dryRun = false, confirmation = "", now = new Date() } = {}) {
    if (!this.context.config.housekeepingEnabled) return { ok: true, skipped: true, reason: "disabled", runType };
    if (!["daily", "monthly", "quarantine_review", "manual"].includes(runType)) {
      throw new CommsHubError(400, "housekeeping_run_type_invalid", "Housekeeping run type is invalid.");
    }
    if ((runType === "monthly" || runType === "manual") && !dryRun && confirmation !== COMMS_HUB_HOUSEKEEPING_CONFIRMATION) {
      throw new CommsHubError(422, "housekeeping_confirmation_required", "Monthly housekeeping requires the exact confirmation value.", {
        publicMessage: "Monthly housekeeping was not confirmed.",
      });
    }
    if (this.running) {
      throw new CommsHubError(409, "housekeeping_already_running", "Comms Hub housekeeping is already running.", {
        retryable: true,
        failureClass: "temporary",
      });
    }

    const at = now instanceof Date ? now : new Date(now);
    const key = windowKey(runType, at, this.context.config.businessTimeZone, dryRun);
    const startedAt = at.toISOString();
    const id = stableId("hkr", key);
    const begun = await this.context.housekeepingRepository.beginRun({ id, windowKey: key, runType, dryRun, actor, startedAt });
    if (!begun.created) {
      const existingStages = (() => { try { return JSON.parse(begun.run?.stages_json || "[]"); } catch { return []; } })();
      if (begun.run?.status === "running") {
        throw new CommsHubError(409, "housekeeping_window_running", "This housekeeping window is already running.", {
          retryable: true,
          failureClass: "temporary",
        });
      }
      return {
        ok: begun.run?.status === "complete",
        skipped: true,
        reason: "window_complete",
        runType,
        windowKey: key,
        permanent: !dryRun,
        stages: existingStages,
        failedStages: existingStages.filter((stage) => !stage.ok).map((stage) => stage.name),
      };
    }

    this.running = true;
    const stages = [];
    try {
      for (const name of this.stagesFor(runType)) {
        try {
          const result = await this.executeStage(name, { at, dryRun, runType });
          stages.push({ name, ok: true, ...result });
        } catch (error) {
          stages.push({ name, ok: false, failure: failure(error) });
        }
      }
      const failedStages = stages.filter((stage) => !stage.ok).map((stage) => stage.name);
      const status = failedStages.length ? "partial" : "complete";
      const completedAt = new Date().toISOString();
      await this.context.housekeepingRepository.finishRun({ id, status, stages, completedAt });
      await this.context.auditService.record({
        actor,
        role: "admin",
        action: "comms_hub_housekeeping_completed",
        objectType: "housekeeping_run",
        objectId: id,
        outcome: failedStages.length ? "failed" : "success",
        details: { runType, windowKey: key, dryRun, failedStages },
      }).catch(() => null);
      return {
        ok: failedStages.length === 0,
        permanent: !dryRun,
        runId: id,
        runType,
        windowKey: key,
        dryRun,
        startedAt,
        completedAt,
        stages,
        failedStages,
      };
    } catch (error) {
      await this.context.housekeepingRepository.finishRun({
        id,
        status: "failed",
        stages,
        completedAt: new Date().toISOString(),
        error: error.message,
      }).catch(() => null);
      throw error;
    } finally {
      this.running = false;
    }
  }

  async status() {
    const [activeRetentionPolicies, runs] = await Promise.all([
      this.context.housekeepingRepository.activeRetentionPolicyCount(),
      this.context.housekeepingRepository.latestRuns(),
    ]);
    return {
      enabled: this.context.config.housekeepingEnabled,
      running: this.running,
      activeRetentionPolicies,
      retentionPolicyHealthy: activeRetentionPolicies > 0,
      runs,
    };
  }
}

export default CommsHubHousekeepingService;
