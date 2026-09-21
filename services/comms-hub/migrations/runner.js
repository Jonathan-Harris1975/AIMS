import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCommsHubConfig } from "../config.js";
import { D1Client } from "../clients/d1Client.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "./manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationDir = path.join(root, "services", "comms-hub", "migrations");
const migrationTableSql = `CREATE TABLE IF NOT EXISTS comms_hub_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;
const migrationLockTableSql = `CREATE TABLE IF NOT EXISTS comms_hub_schema_migration_lock (
  lock_id INTEGER PRIMARY KEY CHECK(lock_id = 1),
  owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function splitSqlStatements(sql) {
  return String(sql || "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

function d1MigrationStatements(sql) {
  return splitSqlStatements(sql).flatMap((statement) => {
    // D1 always enforces foreign keys and executes a batch in an implicit
    // transaction, where SQLite cannot change PRAGMA foreign_keys. Historical
    // rebuild migrations use OFF/ON around copy-and-rename operations, so keep
    // their immutable source/checksums intact while translating that execution
    // contract to D1's supported transaction-scoped constraint deferral.
    if (/^PRAGMA\s+foreign_keys\s*=\s*(?:OFF|FALSE|0)$/i.test(statement)) {
      return ["PRAGMA defer_foreign_keys = ON"];
    }
    if (/^PRAGMA\s+foreign_keys\s*=\s*(?:ON|TRUE|1)$/i.test(statement)) {
      return [];
    }
    return [statement];
  });
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.trunc(parsed);
  if (integer < min || integer > max) return fallback;
  return integer;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadMigrations() {
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const migrations = [];
  for (const name of names) {
    const sql = await readFile(path.join(migrationDir, name), "utf8");
    migrations.push({ version: name.replace(/\.sql$/i, ""), name, sql, checksum: checksum(sql) });
  }
  return migrations;
}

function migrationConfig(env) {
  // Schema changes are administrative operations and deliberately bypass the
  // runtime Worker data plane, whose SQL allow-list excludes DDL.
  return loadCommsHubConfig({
    ...env,
    COMMS_HUB_ENABLED: "true",
    COMMS_HUB_D1_PROXY_URL: "",
    COMMS_HUB_D1_PROXY_TOKEN: "",
    COMMS_HUB_ZERNIO_META_ENABLED: "false",
    COMMS_HUB_ZERNIO_VIDEO_ENABLED: "false",
  }, { requireEnabled: true });
}

async function acquireMigrationLock(d1, env, owner) {
  const waitMs = positiveInteger(env.COMMS_HUB_MIGRATION_LOCK_WAIT_MS, 120_000, { min: 1_000, max: 600_000 });
  const leaseMs = positiveInteger(env.COMMS_HUB_MIGRATION_LOCK_LEASE_MS, 300_000, { min: 30_000, max: 1_800_000 });
  const pollMs = positiveInteger(env.COMMS_HUB_MIGRATION_LOCK_POLL_MS, 750, { min: 100, max: 5_000 });
  const deadline = Date.now() + waitMs;

  await d1.query(migrationLockTableSql);

  while (Date.now() <= deadline) {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const results = await d1.batch([
      {
        sql: `INSERT INTO comms_hub_schema_migration_lock (lock_id, owner, lease_expires_at, updated_at)
              VALUES (1, ?, ?, ?)
              ON CONFLICT(lock_id) DO UPDATE SET
                owner = excluded.owner,
                lease_expires_at = excluded.lease_expires_at,
                updated_at = excluded.updated_at
              WHERE comms_hub_schema_migration_lock.lease_expires_at <= ?
                 OR comms_hub_schema_migration_lock.owner = excluded.owner`,
        params: [owner, leaseExpiresAt, nowIso, nowIso],
      },
      {
        sql: `SELECT owner, lease_expires_at FROM comms_hub_schema_migration_lock WHERE lock_id = 1`,
      },
    ]);
    const lock = results[1]?.results?.[0] || null;
    if (lock?.owner === owner) return { owner, leaseExpiresAt: lock.lease_expires_at || leaseExpiresAt };
    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting ${waitMs}ms for the Comms Hub migration lock.`);
}


async function renewMigrationLock(d1, env, owner) {
  const leaseMs = positiveInteger(env.COMMS_HUB_MIGRATION_LOCK_LEASE_MS, 300_000, { min: 30_000, max: 1_800_000 });
  const now = new Date();
  const result = await d1.query(
    `UPDATE comms_hub_schema_migration_lock
        SET lease_expires_at = ?, updated_at = ?
      WHERE lock_id = 1 AND owner = ?
      RETURNING owner`,
    [new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), owner]
  );
  if (result?.results?.[0]?.owner !== owner) {
    throw new Error("Lost the Comms Hub migration lock before migration completed.");
  }
}

async function releaseMigrationLock(d1, owner) {
  try {
    await d1.query(`DELETE FROM comms_hub_schema_migration_lock WHERE lock_id = 1 AND owner = ?`, [owner]);
  } catch {
    // The lock is lease-based. A failed best-effort release cannot leave a
    // permanent lock behind, so preserve the original migration outcome.
  }
}

async function readAppliedMigrations(d1) {
  await d1.query(migrationTableSql);
  const appliedResult = await d1.query(
    `SELECT version, checksum, applied_at FROM comms_hub_schema_migrations ORDER BY version ASC`
  );
  return new Map((appliedResult.results || []).map((row) => [row.version, row]));
}

function migrationError(code, message, { migration = null, cause = null } = {}) {
  const options = cause ? { cause } : undefined;
  const error = new Error(message, options);
  error.code = code;
  error.migration = migration;
  return error;
}

async function isAttestedLegacyMigration(d1, migration) {
  // 0013 was shipped before the migration file was accidentally reformatted in
  // a later source release. Production D1 therefore contains a legitimate
  // historical checksum which cannot equal the repository checksum. Never
  // rewrite the migration ledger: attest the schema effect that uniquely
  // identifies 0013, then treat that historical row as compatible.
  if (migration.version !== "0013_content_automation_queue") return false;
  try {
    const tableResult = await d1.query(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'comms_hub_delayed_actions'`
    );
    const tableSql = String(tableResult?.results?.[0]?.sql || "");
    if (!/action_type[\s\S]*content_automation/i.test(tableSql)) return false;

    const indexResult = await d1.query(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_comms_hub_delayed_due'`
    );
    return indexResult?.results?.[0]?.name === "idx_comms_hub_delayed_due";
  } catch {
    return false;
  }
}

async function validateMigrationFiles(d1, migrations, applied) {
  const discoveredVersions = new Set(migrations.map((migration) => migration.version));
  const missingFiles = COMMS_HUB_REQUIRED_MIGRATIONS.filter((version) => !discoveredVersions.has(version));
  if (missingFiles.length) {
    throw migrationError("comms_hub_migration_files_missing", `Required Comms Hub migration files are missing: ${missingFiles.join(", ")}`);
  }

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing && existing.checksum !== migration.checksum) {
      if (await isAttestedLegacyMigration(d1, migration)) continue;
      throw migrationError("comms_hub_migration_checksum_mismatch", `Migration checksum mismatch for ${migration.name}. Applied migrations are immutable.`, { migration: migration.version });
    }
  }
}

export async function runCommsHubMigrations({ env = process.env, statusOnly = false, d1: providedD1 = null } = {}) {
  let config;
  try {
    config = migrationConfig(env);
  } catch (cause) {
    throw migrationError("comms_hub_migration_config_failed", "Comms Hub migration configuration is invalid.", { cause });
  }
  const d1 = providedD1 || new D1Client(config);
  let discoveredMigrations;
  try {
    discoveredMigrations = await loadMigrations();
  } catch (cause) {
    throw migrationError("comms_hub_migration_files_unreadable", "Comms Hub migration files could not be loaded.", { cause });
  }
  const required = new Set(COMMS_HUB_REQUIRED_MIGRATIONS);
  const migrations = discoveredMigrations.filter((migration) => required.has(migration.version));

  if (statusOnly) {
    const applied = await readAppliedMigrations(d1);
    await validateMigrationFiles(d1, migrations, applied);
    return {
      ok: true,
      databaseId: config.d1DatabaseId,
      migrations: migrations.map((migration) => ({
        version: migration.version,
        checksum: migration.checksum,
        status: applied.has(migration.version) ? "applied" : "pending",
        appliedAt: applied.get(migration.version)?.applied_at || null,
      })),
    };
  }

  const owner = `aims:${process.pid}:${randomUUID()}`;
  try {
    await acquireMigrationLock(d1, env, owner);
  } catch (cause) {
    throw migrationError("comms_hub_migration_lock_failed", "Comms Hub migration lock could not be acquired.", { cause });
  }
  try {
    // Re-read after acquiring the lock. Another instance may have completed
    // migrations while this instance was waiting.
    let applied;
    try {
      applied = await readAppliedMigrations(d1);
    } catch (cause) {
      throw migrationError("comms_hub_migration_ledger_failed", "Comms Hub migration ledger could not be read.", { cause });
    }
    await validateMigrationFiles(d1, migrations, applied);

    let appliedCount = 0;
    const appliedVersions = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await renewMigrationLock(d1, env, owner);
      const appliedAt = new Date().toISOString();
      try {
        await d1.batch([
          ...d1MigrationStatements(migration.sql).map((sql) => ({ sql })),
          {
            sql: `INSERT INTO comms_hub_schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)`,
            params: [migration.version, migration.checksum, appliedAt],
          },
        ]);
      } catch (cause) {
        // Keep the D1 error as the cause while identifying the exact migration.
        // This is intentionally metadata-only: no SQL, credentials or provider
        // response bodies are exposed through readiness.
        const error = new Error(`Comms Hub migration ${migration.version} failed.`, { cause });
        error.code = cause?.code || "comms_hub_migration_failed";
        error.migration = migration.version;
        throw error;
      }
      appliedCount += 1;
      appliedVersions.push(migration.version);
    }

    return {
      ok: true,
      databaseId: config.d1DatabaseId,
      applied: appliedCount,
      appliedVersions,
      total: migrations.length,
    };
  } finally {
    await releaseMigrationLock(d1, owner);
  }
}

export default runCommsHubMigrations;
