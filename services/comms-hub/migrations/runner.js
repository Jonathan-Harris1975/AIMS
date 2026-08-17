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

function validateMigrationFiles(migrations, applied) {
  const discoveredVersions = new Set(migrations.map((migration) => migration.version));
  const missingFiles = COMMS_HUB_REQUIRED_MIGRATIONS.filter((version) => !discoveredVersions.has(version));
  if (missingFiles.length) {
    throw new Error(`Required Comms Hub migration files are missing: ${missingFiles.join(", ")}`);
  }

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing && existing.checksum !== migration.checksum) {
      throw new Error(`Migration checksum mismatch for ${migration.name}. Applied migrations are immutable.`);
    }
  }
}

export async function runCommsHubMigrations({ env = process.env, statusOnly = false, d1: providedD1 = null } = {}) {
  const config = migrationConfig(env);
  const d1 = providedD1 || new D1Client(config);
  const discoveredMigrations = await loadMigrations();
  const required = new Set(COMMS_HUB_REQUIRED_MIGRATIONS);
  const migrations = discoveredMigrations.filter((migration) => required.has(migration.version));

  if (statusOnly) {
    const applied = await readAppliedMigrations(d1);
    validateMigrationFiles(migrations, applied);
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
  await acquireMigrationLock(d1, env, owner);
  try {
    // Re-read after acquiring the lock. Another instance may have completed
    // migrations while this instance was waiting.
    const applied = await readAppliedMigrations(d1);
    validateMigrationFiles(migrations, applied);

    let appliedCount = 0;
    const appliedVersions = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await renewMigrationLock(d1, env, owner);
      const appliedAt = new Date().toISOString();
      await d1.batch([
        ...splitSqlStatements(migration.sql).map((sql) => ({ sql })),
        {
          sql: `INSERT INTO comms_hub_schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)`,
          params: [migration.version, migration.checksum, appliedAt],
        },
      ]);
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
