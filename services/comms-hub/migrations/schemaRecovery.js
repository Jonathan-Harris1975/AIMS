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
    error.code = "comms_hub_auto_migration_failed";
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
