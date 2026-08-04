import { stableId, sha256Hex } from "./domain/ids.js";
import { CommsHubError, toCommsHubError } from "./errors.js";
import { redactDiagnosticText } from "./domain/redaction.js";

const REQUIRED_RESTORE_TABLES = Object.freeze([
  "comms_hub_conversations",
  "comms_hub_messages",
  "comms_hub_ai_runs",
  "comms_hub_reply_drafts",
  "comms_hub_approvals",
  "comms_hub_backup_runs",
]);

function dayPrefix(date) {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function archiveObjectKey(prefix, sourceKey) {
  const basename = String(sourceKey || "object")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(-120) || "object";
  return `${prefix}/objects/${sha256Hex(sourceKey).slice(0, 32)}-${basename}`;
}

export class CommsHubBackupService {
  constructor({ context }) { this.context = context; }

  assertEnabled() {
    if (!this.context.config.backupEnabled) {
      throw new CommsHubError(503, "comms_hub_backup_disabled", "Comms Hub backup is disabled.", {
        publicMessage: "Comms Hub backup is not enabled.",
      });
    }
    for (const [name, client] of [["source R2", this.context.sourceR2], ["backup R2", this.context.backupR2], ["restore R2", this.context.restoreR2], ["D1 backup", this.context.backupClient]]) {
      if (!client) throw new CommsHubError(503, "comms_hub_backup_dependency_missing", `${name} client is not configured.`, { failureClass: "permanent" });
    }
  }

  async archiveLinkedObjects(backupPrefix) {
    const candidates = new Map();
    for (const prefix of this.context.config.backupObjectPrefixes) {
      for (const object of await this.context.sourceR2.list(prefix)) candidates.set(object.key, object);
    }
    if (candidates.size > this.context.config.backupMaxLinkedObjects) {
      throw new CommsHubError(409, "backup_object_limit_exceeded",
        `Backup found ${candidates.size} linked objects, above the configured limit of ${this.context.config.backupMaxLinkedObjects}.`,
        { failureClass: "permanent", publicMessage: "Backup object limit must be increased before this backup can run." });
    }
    const archived = [];
    for (const object of candidates.values()) {
      const buffer = await this.context.sourceR2.getBuffer(object.key);
      const sha256 = sha256Hex(buffer);
      const archiveKey = archiveObjectKey(backupPrefix, object.key);
      await this.context.backupR2.putBuffer(archiveKey, buffer, "application/octet-stream", {
        sha256,
        source_object_key: object.key,
      });
      archived.push({ ...object, sha256, archiveKey });
    }
    return archived;
  }

  async tableCounts(databaseId) {
    const entries = await Promise.all(REQUIRED_RESTORE_TABLES.map(async (table) => {
      const result = await this.context.backupClient.queryDatabase(databaseId, `SELECT COUNT(*) AS count FROM "${table}"`);
      const count = Number(result[0]?.count ?? result[0]?.["COUNT(*)"] ?? 0);
      if (!Number.isInteger(count) || count < 0) {
        throw new CommsHubError(502, "backup_record_count_invalid", `Could not read a valid record count for ${table}.`);
      }
      return [table, count];
    }));
    return Object.fromEntries(entries);
  }

  async runBackup({ actor = "aims:comms-hub" } = {}) {
    this.assertEnabled();
    const started = new Date();
    const run = {
      id: stableId("bkp", this.context.config.d1DatabaseId, started.toISOString()),
      sourceDatabaseId: this.context.config.d1DatabaseId,
      restoreDatabaseId: this.context.config.restoreDatabaseId || null,
      startedAt: started.toISOString(),
      metadata: { actor: String(actor || "aims:comms-hub").slice(0, 200) },
    };
    await this.context.aiRepository.createBackupRun(run);
    try {
      const recordCounts = await this.tableCounts(run.sourceDatabaseId);
      const exported = await this.context.backupClient.exportDatabase();
      const exportSha256 = sha256Hex(exported.sql);
      const prefix = `backups/${dayPrefix(started)}/${run.id}`;
      const exportKey = `${prefix}/${exported.filename || "comms-hub-export.sql"}`;
      await this.context.aiRepository.updateBackupRun(run.id, { status: "archiving", exportBookmark: exported.bookmark, exportSha256 });
      await this.context.backupR2.putBuffer(exportKey, exported.sql, "application/sql; charset=utf-8", {
        sha256: exportSha256,
        source_database_id: run.sourceDatabaseId,
      });

      const linked = await this.archiveLinkedObjects(prefix);
      const manifest = {
        schemaVersion: 1,
        backupRunId: run.id,
        sourceDatabaseId: run.sourceDatabaseId,
        createdAt: new Date().toISOString(),
        export: { key: exportKey, sha256: exportSha256, sizeBytes: exported.sql.length, bookmark: exported.bookmark || null },
        recordCounts,
        linkedObjects: linked.map((object) => ({
          bucket: this.context.config.r2BucketName,
          sourceKey: object.key,
          archiveKey: object.archiveKey,
          sizeBytes: object.size,
          etag: object.etag || null,
          sha256: object.sha256,
        })),
      };
      const manifestText = JSON.stringify(manifest, null, 2);
      const manifestSha256 = sha256Hex(manifestText);
      const manifestKey = `${prefix}/manifest.json`;
      await this.context.backupR2.putText(manifestKey, manifestText, "application/json; charset=utf-8", { sha256: manifestSha256 });
      await this.context.aiRepository.recordBackupObjects(linked.map((object) => ({
        id: stableId("bko", run.id, object.key),
        backupRunId: run.id,
        bucketName: this.context.config.r2BucketName,
        objectKey: object.key,
        archiveObjectKey: object.archiveKey,
        sizeBytes: object.size,
        etag: object.etag || null,
        sha256: object.sha256,
        status: "recorded",
      })));
      const completedAt = new Date().toISOString();
      await this.context.aiRepository.updateBackupRun(run.id, {
        status: "complete",
        exportSha256,
        manifestSha256,
        r2ExportKey: exportKey,
        r2ManifestKey: manifestKey,
        linkedObjectCount: linked.length,
        completedAt,
      });
      return { id: run.id, status: "complete", exportKey, manifestKey, exportSha256, manifestSha256, linkedObjectCount: linked.length, completedAt };
    } catch (error) {
      const normalised = toCommsHubError(error, { code: "comms_hub_backup_failed", statusCode: 502, failureClass: "recoverable", publicMessage: "Comms Hub backup failed." });
      await this.context.aiRepository.updateBackupRun(run.id, {
        status: normalised.failureClass === "permanent" ? "quarantined" : "failed",
        failureClass: normalised.failureClass || "recoverable",
        error: redactDiagnosticText(normalised.message),
        completedAt: new Date().toISOString(),
      }).catch(() => {});
      throw normalised;
    }
  }

  async validateRestore(backupRunId, { actor = "aims:comms-hub" } = {}) {
    this.assertEnabled();
    const run = await this.context.aiRepository.getBackupRun(backupRunId);
    if (!run) throw new CommsHubError(404, "backup_run_not_found", "Backup run was not found.");
    if (!run.r2_export_key || !run.export_sha256 || !run.r2_manifest_key || !run.manifest_sha256) {
      throw new CommsHubError(409, "backup_not_complete", "Backup has no completed export and manifest to validate.");
    }
    const target = this.context.config.restoreDatabaseId;
    if (!target || target === this.context.config.d1DatabaseId) {
      throw new CommsHubError(503, "restore_database_unconfigured", "COMMS_HUB_RESTORE_DATABASE_ID must identify a separate isolated D1 database.", {
        failureClass: "permanent",
        publicMessage: "An isolated restore database is not configured.",
      });
    }
    await this.context.aiRepository.updateBackupRun(run.id, { status: "validating", validationStatus: "running" });
    try {
      const sql = await this.context.backupR2.getBuffer(run.r2_export_key);
      const actualExportSha256 = sha256Hex(sql);
      if (actualExportSha256 !== run.export_sha256) throw new CommsHubError(409, "backup_export_checksum_mismatch", "Backup export checksum does not match the recorded value.");
      const manifestBuffer = await this.context.backupR2.getBuffer(run.r2_manifest_key);
      const actualManifestSha256 = sha256Hex(manifestBuffer);
      if (actualManifestSha256 !== run.manifest_sha256) {
        throw new CommsHubError(409, "backup_manifest_checksum_mismatch", "Backup manifest checksum does not match the recorded value.");
      }
      let manifest;
      try { manifest = JSON.parse(manifestBuffer.toString("utf8")); } catch {
        throw new CommsHubError(409, "backup_manifest_invalid", "Backup manifest is not valid JSON.");
      }
      if (manifest.backupRunId !== run.id || manifest.sourceDatabaseId !== run.source_database_id
          || manifest.export?.key !== run.r2_export_key || manifest.export?.sha256 !== run.export_sha256) {
        throw new CommsHubError(409, "backup_manifest_mismatch", "Backup manifest does not match the recorded backup run.");
      }
      const existingTables = await this.context.backupClient.queryDatabase(
        target,
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name"
      );
      if (existingTables.length) {
        throw new CommsHubError(409, "restore_target_not_empty", `Restore target contains ${existingTables.length} existing user tables.`, {
          failureClass: "permanent",
          publicMessage: "Restore validation requires a fresh empty database.",
        });
      }
      const importResult = await this.context.backupClient.importDatabase(sql, target);
      const tables = await this.context.backupClient.queryDatabase(target, "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name");
      const tableNames = new Set(tables.map((row) => row.name));
      const missingTables = REQUIRED_RESTORE_TABLES.filter((name) => !tableNames.has(name));
      if (missingTables.length) throw new CommsHubError(409, "restore_schema_incomplete", `Restored database is missing required tables: ${missingTables.join(", ")}.`);
      const restoredCounts = await this.tableCounts(target);
      const countMismatches = REQUIRED_RESTORE_TABLES
        .filter((table) => Number(manifest.recordCounts?.[table]) !== restoredCounts[table])
        .map((table) => ({ table, expected: Number(manifest.recordCounts?.[table]), actual: restoredCounts[table] }));
      if (countMismatches.length) {
        throw new CommsHubError(409, "restore_record_count_mismatch", `${countMismatches.length} restored table counts do not match the backup manifest.`);
      }

      const recordedObjects = await this.context.aiRepository.getBackupObjects(run.id);
      const manifestObjects = new Map((manifest.linkedObjects || []).map((object) => [object.sourceKey, object]));
      if (manifestObjects.size !== recordedObjects.length) {
        throw new CommsHubError(409, "backup_manifest_object_count_mismatch", "Backup manifest object count does not match the backup catalogue.");
      }
      const objectChecks = [];
      for (const object of recordedObjects) {
        try {
          const manifestObject = manifestObjects.get(object.object_key);
          if (!manifestObject || manifestObject.archiveKey !== object.archive_object_key || manifestObject.sha256 !== object.sha256) {
            objectChecks.push({ key: object.object_key, status: "mismatch", sha256: null });
            continue;
          }
          const buffer = await this.context.backupR2.getBuffer(object.archive_object_key);
          const archiveChecksum = sha256Hex(buffer);
          if (archiveChecksum !== object.sha256) {
            objectChecks.push({ key: object.object_key, status: "mismatch", sha256: archiveChecksum });
            continue;
          }
          const restoreKey = `restore-validation/${run.id}/${object.archive_object_key.split("/").at(-1)}`;
          await this.context.restoreR2.putBuffer(restoreKey, buffer, "application/octet-stream", {
            sha256: object.sha256,
            source_backup_run_id: run.id,
            source_object_key: object.object_key,
          });
          const restoredBuffer = await this.context.restoreR2.getBuffer(restoreKey);
          const restoredChecksum = sha256Hex(restoredBuffer);
          objectChecks.push({
            key: object.object_key,
            restoreKey,
            status: restoredChecksum === object.sha256 ? "verified" : "mismatch",
            sha256: restoredChecksum,
          });
        } catch {
          objectChecks.push({ key: object.object_key, status: "missing", sha256: null });
        }
      }
      await this.context.aiRepository.updateBackupObjectStatuses(run.id, objectChecks);
      const failedObjects = objectChecks.filter((item) => item.status !== "verified");
      if (failedObjects.length) throw new CommsHubError(409, "restore_linked_objects_invalid", `${failedObjects.length} linked private objects failed restore validation.`);
      const validatedAt = new Date().toISOString();
      const details = {
        actor: String(actor || "aims:comms-hub").slice(0, 200),
        targetDatabaseId: target,
        exportSha256: actualExportSha256,
        manifestSha256: actualManifestSha256,
        requiredTables: REQUIRED_RESTORE_TABLES,
        recordCounts: restoredCounts,
        importedQueries: importResult?.result?.num_queries || importResult?.num_queries || null,
        linkedObjectsVerified: objectChecks.length,
        restoreBucket: this.context.config.r2RestoreBucketName,
      };
      await this.context.aiRepository.updateBackupRun(run.id, {
        status: "validated",
        validationStatus: "passed",
        validationDetails: details,
        validatedAt,
      });
      return { id: run.id, status: "validated", validatedAt, details };
    } catch (error) {
      const normalised = toCommsHubError(error, { code: "restore_validation_failed", statusCode: 502, failureClass: "recoverable", publicMessage: "Restore validation failed." });
      await this.context.aiRepository.updateBackupRun(run.id, {
        status: "failed",
        validationStatus: "failed",
        validationDetails: { actor: String(actor || "aims:comms-hub").slice(0, 200) },
        failureClass: normalised.failureClass || "recoverable",
        error: redactDiagnosticText(normalised.message),
        validatedAt: new Date().toISOString(),
      }).catch(() => {});
      throw normalised;
    }
  }
}

export default CommsHubBackupService;
