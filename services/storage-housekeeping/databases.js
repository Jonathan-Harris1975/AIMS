import { DAY, LIMITS, POLICY_VERSION, excludedDatabase } from "./policy.js";

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const count = (rows) => Number(rows[0]?.count || 0);

export function sameRow(row, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return { sql: Object.keys(row).map((key) => `${prefix}${quote(key)} IS ?`).join(" AND "), params: Object.values(row) };
}

function childDeletes(incident, attempts, parentTable, childTable, identityColumn, returnColumn) {
  const parent = sameRow(incident, "i");
  const children = attempts.map((attempt) => sameRow(attempt, "a"));
  const unchangedChildren = children.length ? `AND NOT EXISTS (
    SELECT 1 FROM ${quote(childTable)} a WHERE a.${identityColumn} = i.${identityColumn}
      AND NOT (${children.map((child) => `(${child.sql})`).join(" OR ")})
  )` : "";
  const statements = [
    { sql: `DELETE FROM ${quote(childTable)} WHERE ${identityColumn} = ? AND EXISTS (
        SELECT 1 FROM ${quote(parentTable)} i WHERE ${parent.sql}
          AND (SELECT COUNT(*) FROM ${quote(childTable)} a WHERE a.${identityColumn} = i.${identityColumn}) = ?
          ${unchangedChildren}
      ) RETURNING ${returnColumn}`,
    params: [incident[identityColumn], ...parent.params, attempts.length, ...children.flatMap((child) => child.params)] },
  ];
  return statements.every((statement) => statement.params.length <= 100) ? statements : null;
}

export function recoveryDeletes(incident, attempts) {
  return childDeletes(incident, attempts, "recovery_incidents", "recovery_attempts", "incident_id", "attempt");
}

export async function maintainDatabase(database, { client, archive, check, now, dryRun, comms }) {
  if (excludedDatabase(database)) throw new Error("KDP database cannot be maintained");
  const result = { name: database.name, id: database.uuid, ok: true, archived: 0, deleted: 0, changedSinceSnapshot: 0, policies: [] };
  // The isolated Comms restore database is rebuilt by the verified monthly
  // restore manager; never janitor its restored application tables directly.
  if (database.name === "COMMS_HUB_RESTORE_DATABASE") return { ...result, delegated: "comms_monthly_restore_manager" };
  if (database.name === "database-comms-hub") {
    const status = await comms();
    if (!status.retentionPolicyHealthy || !status.enabled) throw new Error("Comms housekeeping is not healthy");
    return { ...result, delegated: "comms_daily_and_monthly_housekeeping", retentionPolicyHealthy: true };
  }
  const schema = await client.query(database,
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name");
  const tables = new Set(schema.map((table) => table.name));
  result.tables = [...tables];
  const known = new Set();
  const snapshot = (kind, records) => ({ schemaVersion: 1, policyVersion: POLICY_VERSION, kind, database,
    schema: schema.filter((table) => Object.hasOwn(records, table.name)), records });

  if (tables.has("recovery_incidents") && tables.has("recovery_attempts")) {
    known.add("recovery_incidents"); known.add("recovery_attempts");
    const cutoff = Math.floor((now - 180 * DAY) / 1000);
    const incidents = await client.query(database, `SELECT i.* FROM recovery_incidents i
      WHERE i.status = 'verified' AND i.updated_at < ? AND (i.lease_until IS NULL OR i.lease_until <= ?)
        AND EXISTS (SELECT 1 FROM recovery_attempts a WHERE a.incident_id = i.incident_id)
        AND NOT EXISTS (SELECT 1 FROM recovery_attempts a WHERE a.incident_id = i.incident_id
          AND (a.finished_at IS NULL OR a.outcome IS NULL OR a.finished_at >= ? OR a.started_at >= ?))
      ORDER BY i.updated_at, i.incident_id LIMIT ?`, [cutoff, Math.floor(now / 1000), cutoff, cutoff, LIMITS.rows]);
    const policy = { tables: ["recovery_incidents", "recovery_attempts"], retentionDays: 180,
      eligible: incidents.length, unresolved: "retain", activeLeases: "retain", unfinishedAttempts: "retain",
      deduplicationReceipts: "retain_parent_records_permanently", boundedSnapshotsRetained: 0 };
    result.policies.push(policy);
    for (const incident of incidents) {
      check();
      const attempts = await client.query(database,
        "SELECT * FROM recovery_attempts WHERE incident_id = ? ORDER BY attempt LIMIT 12", [incident.incident_id]);
      const statements = recoveryDeletes(incident, attempts);
      if (!statements) { policy.boundedSnapshotsRetained += 1; continue; }
      if (dryRun) continue;
      await archive(snapshot("verified_recovery_after_180_days", { recovery_incidents: [incident], recovery_attempts: attempts }));
      result.archived += 1;
      check();
      const deleted = await client.batch(database, statements);
      const removed = deleted[0].results.length;
      result.deleted += removed;
      if (!removed) result.changedSinceSnapshot += 1;
    }
  }

  if (tables.has("incidents") && tables.has("incident_events")) {
    known.add("incidents"); known.add("incident_events");
    // RAMS' legacy coordinator uses 'resolved' as its replay barrier. Retain
    // that parent receipt; archive/prune only its old event history.
    const incidents = await client.query(database, `SELECT i.* FROM incidents i
      WHERE i.state = 'resolved' AND i.updated_at < ? AND i.lease_until <= ?
        AND EXISTS (SELECT 1 FROM incident_events e WHERE e.incident_key = i.incident_key)
        AND NOT EXISTS (SELECT 1 FROM incident_events e WHERE e.incident_key = i.incident_key AND e.occurred_at >= ?)
      ORDER BY i.updated_at, i.incident_key LIMIT ?`, [Math.floor((now - 180 * DAY) / 1000), Math.floor(now / 1000), Math.floor((now - 180 * DAY) / 1000), LIMITS.rows]);
    result.policies.push({ tables: ["incidents", "incident_events"], eligible: incidents.length, retentionDays: 180, deduplicationReceipts: "retain" });
    for (const incident of incidents) {
      check();
      const events = await client.query(database, "SELECT * FROM incident_events WHERE incident_key = ? ORDER BY id LIMIT 16", [incident.incident_key]);
      const statements = childDeletes(incident, events, "incidents", "incident_events", "incident_key", "id");
      if (!statements || dryRun) continue;
      await archive(snapshot("resolved_legacy_recovery_after_180_days", { incidents: [incident], incident_events: events }));
      result.archived += 1;
      check();
      const removed = (await client.batch(database, statements))[0].results.length;
      result.deleted += removed;
      if (!removed) result.changedSinceSnapshot += 1;
    }
  }

  for (const table of ["hive_cost_events", "hive_file_chunks"]) {
    if (!tables.has(table)) continue;
    known.add(table);
    const days = table === "hive_cost_events" ? 365 : 30;
    if (table === "hive_file_chunks" && !tables.has("hive_files")) throw new Error("Cannot reconcile chunks without file catalogue");
    const orphan = table === "hive_file_chunks"
      ? "AND NOT EXISTS (SELECT 1 FROM hive_files f WHERE f.object_key = c.object_key)" : "";
    const timestamp = table === "hive_file_chunks" ? "updated_at" : "created_at";
    const cutoff = new Date(now - days * DAY).toISOString();
    const rows = await client.query(database, `SELECT c.* FROM ${quote(table)} c
      WHERE julianday(c.${timestamp}) < julianday(?) ${orphan} ORDER BY c.${timestamp}, c.id LIMIT ?`, [cutoff, LIMITS.rows]);
    result.policies.push({ table, retentionDays: days, eligible: rows.length, condition: orphan ? "unreferenced_chunks_only" : "historical_cost_telemetry" });
    for (const row of rows) {
      check();
      if (dryRun) continue;
      await archive(snapshot(table, { [table]: [row] }));
      result.archived += 1;
      check();
      const expected = sameRow(row, "c");
      const removed = await client.query(database, `DELETE FROM ${quote(table)} AS c WHERE ${expected.sql} ${orphan} RETURNING id`, expected.params);
      result.deleted += removed.length;
      if (!removed.length) result.changedSinceSnapshot += 1;
    }
  }
  // Conversations, messages, file catalogues, ecosystem indexes, drill probes
  // and unfamiliar tables are durable records, not age-based deletion targets.
  result.retainedTables = [];
  for (const table of tables) {
    if (known.has(table)) continue;
    const size = await client.query(database, `SELECT COUNT(*) AS count FROM ${quote(table)}`);
    result.retainedTables.push({ table, rows: count(size), policy: "retain_durable_or_unclassified_records" });
  }
  return result;
}
