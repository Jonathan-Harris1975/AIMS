import "../config/loadEnv.js";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCommsHubConfig } from "../services/comms-hub/config.js";
import { D1Client } from "../services/comms-hub/clients/d1Client.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(root, "services", "comms-hub", "migrations");
const migrationTableSql = `CREATE TABLE IF NOT EXISTS comms_hub_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
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

async function main() {
  const statusOnly = process.argv.includes("--status");
  const config = loadCommsHubConfig({ ...process.env, COMMS_HUB_ENABLED: "true" }, { requireEnabled: true });
  const d1 = new D1Client(config);
  await d1.query(migrationTableSql);
  const appliedResult = await d1.query(
    `SELECT version, checksum, applied_at FROM comms_hub_schema_migrations ORDER BY version ASC`
  );
  const applied = new Map((appliedResult.results || []).map((row) => [row.version, row]));
  const migrations = await loadMigrations();
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

  if (statusOnly) {
    console.log(JSON.stringify({
      ok: true,
      databaseId: config.d1DatabaseId,
      migrations: migrations.map((migration) => ({
        version: migration.version,
        checksum: migration.checksum,
        status: applied.has(migration.version) ? "applied" : "pending",
        appliedAt: applied.get(migration.version)?.applied_at || null,
      })),
    }, null, 2));
    return;
  }

  let appliedCount = 0;
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const appliedAt = new Date().toISOString();
    await d1.batch([
      ...splitSqlStatements(migration.sql).map((sql) => ({ sql })),
      {
        sql: `INSERT INTO comms_hub_schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)`,
        params: [migration.version, migration.checksum, appliedAt],
      },
    ]);
    appliedCount += 1;
    console.log(`Applied ${migration.name}`);
  }

  console.log(JSON.stringify({ ok: true, applied: appliedCount, total: migrations.length }));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
