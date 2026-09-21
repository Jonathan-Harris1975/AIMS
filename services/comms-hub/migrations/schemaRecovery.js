import { runCommsHubMigrations } from "./runner.js";

export async function recoverCommsHubSchema({
  repository,
  autoMigrateOnStart = true,
  env = process.env,
  migrationRunner = runCommsHubMigrations,
  onMigrationStart = null,
} = {}) {
  if (!repository || typeof repository.schemaStatus !== "function") {
    throw new TypeError("Comms Hub schema recovery requires a repository with schemaStatus().");
  }

  const before = await repository.schemaStatus();
  if (before.available) {
    return { schema: before, migrated: false, migration: null, before };
  }

  if (!autoMigrateOnStart) {
    return { schema: before, migrated: false, migration: null, before };
  }

  if (typeof onMigrationStart === "function") await onMigrationStart(before);

  let migration;
  try {
    migration = await migrationRunner({ env });
  } catch (cause) {
    const error = new Error("Automatic Comms Hub schema migration failed.", { cause });
    // Preserve a safe machine-readable root cause for readiness/operations.
    // The previous implementation collapsed every D1/configuration/migration
    // failure into one generic token, which made a production 503 impossible
    // to diagnose from HIVE without direct service-log access.
    error.code = "comms_hub_auto_migration_failed";
    error.failureCode = String(cause?.code || cause?.name || "migration_failed")
      .trim()
      .replace(/[^A-Za-z0-9_.:-]+/g, "_")
      .slice(0, 120) || "migration_failed";
    error.migration = cause?.migration || null;
    throw error;
  }

  const after = await repository.schemaStatus();
  return {
    schema: after,
    migrated: Number(migration?.applied || 0) > 0,
    migration,
    before,
  };
}

export default recoverCommsHubSchema;
