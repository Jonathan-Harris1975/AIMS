import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import request from "supertest";
import { HousekeepingClient } from "../services/storage-housekeeping/client.js";
import { maintainDatabase, recoveryDeletes } from "../services/storage-housekeeping/databases.js";
import { createHousekeepingService, maintainBucket, verifiedArchive } from "../services/storage-housekeeping/service.js";
import { DAY, KDP_DATABASE_ID, SCOPE, assertObjectScope, excludedDatabase, ruleFor, selectObjects } from "../services/storage-housekeeping/policy.js";
import { createStorageHousekeepingRouter } from "../services/storage-housekeeping/index.js";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const DATABASE = { name: "aims-autonomous-recovery", uuid: "recovery-test" };
const OLD = new Date(NOW - 800 * DAY).toISOString();

function sqliteClient(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE recovery_incidents (incident_id TEXT PRIMARY KEY, repository TEXT, revision TEXT, signal TEXT,
      status TEXT, attempts INTEGER, owner TEXT, lease_until INTEGER, next_attempt_after INTEGER, last_error_code TEXT,
      created_at INTEGER, updated_at INTEGER);
    CREATE TABLE recovery_attempts (incident_id TEXT REFERENCES recovery_incidents(incident_id), attempt INTEGER,
      owner TEXT, revision TEXT, started_at INTEGER, finished_at INTEGER, outcome TEXT, evidence_key TEXT,
      PRIMARY KEY(incident_id,attempt));`);
  const query = async (_database, sql, params = []) => db.prepare(sql).all(...params).map((row) => ({ ...row }));
  const client = { query, async batch(database, statements) {
    db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push({ success: true, results: await query(database, statement.sql, statement.params) });
      db.exec("COMMIT"); return results;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } };
  function seed(id, { status = "verified", lease = null, finished = 1, attempts = 1 } = {}) {
    db.prepare("INSERT INTO recovery_incidents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, "AIMS", "revision", "test", status, attempts, null, lease, 0, null, 1, 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) db.prepare("INSERT INTO recovery_attempts VALUES (?,?,?,?,?,?,?,?)")
      .run(id, attempt, "owner", "revision", 1, finished, finished ? "verified" : null, "evidence.json");
  }
  return { db, client, seed };
}

function context(client, overrides = {}) {
  return { client, archive: async () => ({}), check() {}, now: NOW, dryRun: false, comms: async () => ({ enabled: true, retentionPolicyHealthy: true }), ...overrides };
}

test("recovery retention archives verified incidents atomically while protecting holds, leases and unfinished attempts", async (t) => {
  const { db, client, seed } = sqliteClient(t);
  seed("eligible"); seed("held", { status: "held" }); seed("open", { status: "open" });
  seed("leased", { lease: NOW / 1000 + 3600 }); seed("unfinished", { finished: null });
  seed("recent-attempt", { finished: NOW / 1000 });
  const archives = [];
  const result = await maintainDatabase(DATABASE, context(client, { archive: async (snapshot) => { archives.push(snapshot); } }));
  assert.equal(result.deleted, 1);
  assert.equal(archives.length, 1);
  assert.equal(archives[0].records.recovery_incidents[0].incident_id, "eligible");
  assert.equal(archives[0].records.recovery_attempts.length, 1);
  assert.equal(archives[0].schema.length, 2);
  assert.deepEqual(db.prepare("SELECT incident_id FROM recovery_incidents ORDER BY incident_id").all().map((row) => row.incident_id),
    ["eligible", "held", "leased", "open", "recent-attempt", "unfinished"]);
  assert.equal(db.prepare("SELECT status FROM recovery_incidents WHERE incident_id='eligible'").get().status, "verified");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recovery_attempts").get().n, 5);
  const second = await maintainDatabase(DATABASE, context(client, { archive: async () => { throw Error("receipt must not be archived repeatedly"); } }));
  assert.equal(second.archived, 0);
});

test("RAMS legacy event history is retired without removing its resolved replay barrier", async (t) => {
  const { db, client } = sqliteClient(t);
  db.exec(`CREATE TABLE incidents(incident_key TEXT PRIMARY KEY, attempt_key TEXT, repository TEXT, head_sha TEXT,
      owner TEXT, lease_until INTEGER, attempts INTEGER, state TEXT, updated_at INTEGER);
    CREATE TABLE incident_events(id INTEGER PRIMARY KEY, incident_key TEXT, attempt_key TEXT, event TEXT, owner TEXT, occurred_at INTEGER);
    INSERT INTO incidents VALUES('resolved','attempt','RAMS','sha',NULL,0,1,'resolved',1),('active','attempt','RAMS','sha',NULL,0,1,'pending',1);
    INSERT INTO incident_events VALUES(1,'resolved','attempt','resolved','owner',1),(2,'active','attempt','acquired','owner',1);`);
  const result = await maintainDatabase({ ...DATABASE, name: "rams-autonomous-recovery" }, context(client));
  assert.equal(result.deleted, 1);
  assert.equal(db.prepare("SELECT attempt_key FROM incidents WHERE incident_key='resolved'").get().attempt_key, "attempt");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM incidents").get().n, 2);
  assert.equal(db.prepare("SELECT incident_key FROM incident_events").get().incident_key, "active");
});

test("a re-opened incident is preserved with all attempts after its archive snapshot", async (t) => {
  const { db, client, seed } = sqliteClient(t); seed("race");
  const result = await maintainDatabase(DATABASE, context(client, { archive: async () => {
    db.exec("UPDATE recovery_incidents SET status='open' WHERE incident_id='race'");
  } }));
  assert.equal(result.deleted, 0);
  assert.equal(result.changedSinceSnapshot, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recovery_attempts").get().n, 1);
});

test("changing child evidence without changing the incident also prevents deletion", async (t) => {
  const { db, client, seed } = sqliteClient(t); seed("race");
  const result = await maintainDatabase(DATABASE, context(client, { archive: async () => {
    db.exec("UPDATE recovery_attempts SET evidence_key='new-evidence.json' WHERE incident_id='race'");
  } }));
  assert.equal(result.deleted, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recovery_incidents").get().n, 1);
});

test("archive failure and parameter bounds never remove incident data", async (t) => {
  const { db, client, seed } = sqliteClient(t); seed("protected");
  await assert.rejects(() => maintainDatabase(DATABASE, context(client, { archive: async () => { throw Error("checksum mismatch"); } })), /checksum mismatch/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM recovery_incidents").get().n, 1);
  const incident = db.prepare("SELECT * FROM recovery_incidents").get();
  const attempt = db.prepare("SELECT * FROM recovery_attempts").get();
  assert.equal(recoveryDeletes(incident, Array.from({ length: 20 }, () => attempt)), null);
});

test("cost telemetry and orphan chunks are archived without deleting live conversations or file chunks", async (t) => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE hive_cost_events(id TEXT PRIMARY KEY, created_at TEXT);
    CREATE TABLE hive_files(id TEXT PRIMARY KEY, object_key TEXT);
    CREATE TABLE hive_file_chunks(id TEXT PRIMARY KEY, object_key TEXT, updated_at TEXT);
    CREATE TABLE hive_conversations(id TEXT PRIMARY KEY);
    INSERT INTO hive_cost_events VALUES('old','2020-01-01T00:00:00Z'),('recent','2026-11-01T00:00:00Z');
    INSERT INTO hive_files VALUES('file','active.txt');
    INSERT INTO hive_file_chunks VALUES('orphan','missing.txt','2020-01-01T00:00:00Z'),('live','active.txt','2020-01-01T00:00:00Z');
    INSERT INTO hive_conversations VALUES('keep');`);
  const client = { query: async (_d, sql, params = []) => db.prepare(sql).all(...params).map((row) => ({ ...row })) };
  const result = await maintainDatabase({ uuid: "hive", name: "hive-operational-d1" }, context(client));
  assert.equal(result.deleted, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hive_conversations").get().n, 1);
  assert.equal(db.prepare("SELECT id FROM hive_file_chunks").get().id, "live");
  assert.equal(db.prepare("SELECT id FROM hive_cost_events").get().id, "recent");
});

test("KDP is excluded by both identity and name, and the R2 manuscript prefix is forbidden", async () => {
  assert.equal(excludedDatabase({ name: "kDp", uuid: "other" }), true);
  assert.equal(excludedDatabase({ name: "renamed", uuid: KDP_DATABASE_ID }), true);
  const query = () => { throw Error("must not query KDP"); };
  await assert.rejects(() => maintainDatabase({ name: "KDP", uuid: "other" }, context({ query })), /cannot be maintained/);
  assert.throws(() => assertObjectScope("kdp", "Manuscripts pdf format/book.pdf"), /outside/);
  assert.equal(ruleFor("kdp", "metadata/latest.json"), null);
  for (const key of ["research/weekly/state.json", "research/history/1.json", "research/updates/2020-01-01/1.json", "research/update-control.json"]) {
    assert.equal(ruleFor("kdp", key), null);
  }
});

class MemoryStorage {
  constructor() { this.objects = new Map(); this.deleted = []; this.lifecycleCalls = []; this.writes = []; }
  seed(bucket, key, data, date = OLD) {
    const body = Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    this.objects.set(`${bucket}/${key}`, { body, etag: `etag-${key}`, contentType: "application/json", metadata: {}, size: body.length, lastModified: date, key });
  }
  async list(bucket, prefix) { return [...this.objects.entries()].filter(([key]) => key.startsWith(`${bucket}/${prefix}`)).map(([, value]) => ({ ...value })); }
  async get(bucket, key) {
    const value = this.objects.get(`${bucket}/${key}`);
    if (!value) throw Object.assign(Error("missing"), { name: "NoSuchKey" });
    return value;
  }
  async put(key, body, options) {
    this.writes.push(key);
    if (options?.immutable && this.objects.has(`hive/${key}`)) return;
    this.seed("hive", key, body.toString());
  }
  async json(key) { const value = this.objects.get(`hive/${key}`); return value ? JSON.parse(value.body) : null; }
  async unchanged(bucket, object) { return (await this.get(bucket, object.key)).etag === object.etag; }
  async deleteRetiredReport(bucket, key) { this.deleted.push(key); this.objects.delete(`${bucket}/${key}`); }
  async lifecycle(bucket, options) { this.lifecycleCalls.push({ bucket, ...options }); return { ok: true }; }
  async assertPrivateArchive() {}
  async databases() { return []; }
}

test("R2 cleanup protects latest pointer targets and keeps recent representatives", async () => {
  const storage = new MemoryStorage();
  for (let n = 1; n <= 5; n += 1) storage.seed("kdp", `audit/reports/2020-01-0${n}/report-${n}.json`, { ok: true, complete: true, completedAt: OLD });
  storage.seed("kdp", "audit/reports/latest.json", { reportRef: "r2://kdp/audit/reports/2020-01-05/report-5.json" });
  const result = await maintainBucket("kdp", context(storage, { archive: (payload) => verifiedArchive(storage, payload) }));
  assert.equal(result.deleted, 1);
  assert.equal(storage.deleted.includes("audit/reports/2020-01-05/report-5.json"), false);
  assert.equal(selectObjects("kdp", await storage.list("kdp", "audit/"), NOW).length, 1);
});

test("a changed R2 report is archived but not removed, and corrupt archives stop cleanup", async () => {
  const storage = new MemoryStorage();
  for (let n = 1; n <= 4; n += 1) storage.seed("metasystem", `reports/openrouter-daily/2020-01-0${n}.json`, { value: n });
  storage.unchanged = async () => false;
  const result = await maintainBucket("metasystem", context(storage, { archive: (payload) => verifiedArchive(storage, payload) }));
  assert.equal(result.deleted, 0);
  assert.equal(result.archived, 1);
  const bad = new MemoryStorage();
  bad.put = async (key) => bad.seed("hive", key, "corrupted archive");
  await assert.rejects(() => verifiedArchive(bad, { kind: "r2", source: { bucket: "metasystem", key: "report.json" }, data: "important" }), /checksum/);
  assert.deepEqual(bad.deleted, []);
});

test("only terminal green CI bundles are eligible and their evidence file is removed last", async () => {
  const storage = new MemoryStorage();
  const head = "a".repeat(40);
  const green = { final_state: "GREEN", head_sha: head, deployed_sha: head, deployment_status: "pass", deployment_verified: true,
    ci_gate: "pass", socket_status: "pass", codeql_status: "pass", gitleaks_status: "pass", trivy_status: "pass" };
  for (let n = 1; n <= 5; n += 1) {
    const prefix = `ci-reports/AIMS/2020/01/${head}/lifecycle/run-${n}/attempt-1/`;
    storage.seed("hive-repositories", `${prefix}evidence.json`, n === 5 ? { ...green, final_state: "REVIEW_REQUIRED" } : green);
    storage.seed("hive-repositories", `${prefix}evidence-manifest.json`, { id: n });
  }
  const result = await maintainBucket("hive-repositories", context(storage, { archive: (payload) => verifiedArchive(storage, payload) }));
  assert.equal(result.deleted, 2);
  assert.match(storage.deleted[0], /evidence-manifest\.json$/);
  assert.match(storage.deleted[1], /evidence\.json$/);
  assert.ok(!storage.deleted.some((key) => key.includes("run-5/")));
});

test("a completed weekly run is deduplicated without overwriting its durable success record", async () => {
  const client = new MemoryStorage();
  const previous = { ok: true, runId: "completed", completedAt: new Date(NOW).toISOString() };
  client.seed("hive", "housekeeping/runs/2026-11-02.json", previous);
  let releases = 0;
  const service = createHousekeepingService({ client, clock: () => NOW,
    claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => { releases += 1; } });
  assert.equal((await service.run({ dryRun: false })).skipped, true);
  assert.equal(releases, 1);
  assert.deepEqual(await client.json("housekeeping/runs/2026-11-02.json"), previous);
  assert.deepEqual(client.writes, []);
});

test("a preview covers every R2 resource without changing lifecycle or deleting records", async () => {
  const client = new MemoryStorage();
  const service = createHousekeepingService({ client, clock: () => NOW,
    claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => {} });
  const report = await service.run({ dryRun: true });
  assert.equal(report.ok, true);
  assert.equal(report.resources.length, Object.keys(SCOPE).length);
  assert.ok(client.lifecycleCalls.every((call) => call.apply === false));
  assert.deepEqual(client.deleted, []);
  assert.ok(client.writes.every((key) => !key.startsWith("housekeeping/archives/")));
});

test("public archive storage and local lease fallbacks fail closed", async () => {
  const client = new MemoryStorage(); client.assertPrivateArchive = async () => { throw Error("public bucket"); };
  const service = createHousekeepingService({ client, clock: () => NOW,
    claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => {} });
  assert.equal((await service.run({ dryRun: false })).ok, false);
  assert.deepEqual(client.writes, []);
  const local = createHousekeepingService({ client, claim: async () => ({ claimed: true, lease: { backend: "local" } }), release: async () => {} });
  await assert.rejects(() => local.run(), /Local housekeeping leases/);
});

test("D1 batch API uses the documented object envelope and refuses KDP mutations", async () => {
  const requests = [];
  const api = { async requestApi(method, url, body) {
    requests.push({ method, url, body });
    return body.batch.map(() => ({ success: true, results: [] }));
  } };
  const client = new HousekeepingClient({ cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4", cloudflareAccountId: "account" }, { api, s3: {} });
  const statements = [{ sql: "DELETE FROM disposable WHERE id=?", params: ["test"] }];
  await client.batch(DATABASE, statements);
  assert.deepEqual(requests[0].body, { batch: statements });
  await assert.rejects(() => client.batch({ name: "KDP", uuid: "other" }, statements), /excluded/);
  assert.equal(requests.length, 1);
});

test("R2 pagination cannot silently truncate inventory", async () => {
  const pages = [
    { Contents: [{ Key: "research/first.json", LastModified: new Date(OLD) }], IsTruncated: true, NextContinuationToken: "cursor" },
    { Contents: [], IsTruncated: true, NextContinuationToken: "cursor" },
  ];
  const client = new HousekeepingClient({}, { api: {}, s3: { send: async () => pages.shift() } });
  await assert.rejects(() => client.list("kdp", "research/"), /pagination is incomplete/);
  await assert.rejects(() => client.list("kdp", "Manuscripts pdf format/"), /outside/);
});

test("lifecycle maintenance tolerates server rule ordering, leaves KDP untouched and disables broad expiry", async () => {
  const rules = [{ id: "ci-reports-expire-90-days", enabled: true, conditions: { prefix: "ci-reports/" }, deleteObjectsTransition: {} }];
  let stored = { rules };
  const calls = [];
  const api = { async requestApi(method, url, body) {
    calls.push({ method, url });
    if (method === "PUT") stored = body;
    return { rules: [...stored.rules].reverse() };
  } };
  const client = new HousekeepingClient({ cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4", cloudflareAccountId: "account" }, { api, s3: {} });
  await client.lifecycle("kdp", { apply: true });
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
  await client.lifecycle("hive-repositories", { apply: true });
  assert.equal(stored.rules[0].enabled, false);
  assert.ok(stored.rules.some((rule) => rule.abortMultipartUploadsTransition));
});

test("lifecycle verification still rejects semantic changes to the retention rules", async () => {
  let stored = { rules: [] };
  const api = { async requestApi(method, _url, body) {
    if (method === "PUT") { stored = structuredClone(body); stored.rules[0].abortMultipartUploadsTransition.condition.maxAge = 1; }
    return stored;
  } };
  const client = new HousekeepingClient({ cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4", cloudflareAccountId: "account" }, { api, s3: {} });
  await assert.rejects(() => client.lifecycle("hive", { apply: true }), /read-back mismatch/);
});

test("the route rejects string booleans and unconfirmed live mutations before starting a job", async () => {
  const app = express(); app.use(express.json());
  app.use(createStorageHousekeepingRouter({ service: { run: () => { throw Error("must not start"); } } }));
  assert.equal((await request(app).post("/run").send({ dryRun: "true" })).status, 400);
  assert.equal((await request(app).post("/run").send({ dryRun: false })).status, 422);
  assert.equal((await request(app).post("/run").send({ force: "false" })).status, 400);
});
