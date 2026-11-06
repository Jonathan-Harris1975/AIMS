import { createHash, randomUUID } from "node:crypto";
import { loadCommsHubConfig } from "../comms-hub/config.js";
import { getCommsHubContext } from "../comms-hub/runtime.js";
import { redactDiagnosticText } from "../comms-hub/domain/redaction.js";
import { claimDurableLease, releaseDurableLease } from "../shared/utils/durableLease.js";
import { hasDurableStateEnv } from "../shared/utils/durableStateEnv.js";
import { HousekeepingClient, missing } from "./client.js";
import { maintainDatabase } from "./databases.js";
import { ARCHIVE_BUCKET, DAY, LIMITS, POLICY_VERSION, SCOPE, canonical, pointerKeys, selectObjects, terminalObject, weekKey } from "./policy.js";

export const CONFIRMATION = "run-governed-storage-housekeeping";
const bytes = (value) => Buffer.from(JSON.stringify(canonical(value)));
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const failure = (error, fallback) => ({ error: error.code || fallback, detail: redactDiagnosticText(error.message || fallback).slice(0, 250) });

export async function verifiedArchive(client, payload) {
  const body = bytes(payload);
  if (body.length > LIMITS.objectBytes * 2) throw new Error("Archive snapshot exceeds bound");
  const digest = sha256(body);
  const source = payload.source ? `${payload.source.bucket}/${sha256(Buffer.from(payload.source.key))}` : payload.database.uuid;
  const key = `housekeeping/archives/${payload.kind}/${source}/${digest}.json`;
  await client.put(key, body, { immutable: true });
  const stored = await client.get(ARCHIVE_BUCKET, key, LIMITS.objectBytes * 2);
  if (sha256(stored.body) !== digest) throw new Error("Archive checksum read-back failed");
  return { key, sha256: digest };
}

export async function maintainBucket(bucket, { client, archive, check, now, dryRun }) {
  const objects = [];
  for (const prefix of SCOPE[bucket]) objects.push(...await client.list(bucket, prefix));
  const result = { bucket, prefixes: SCOPE[bucket], ok: true, scanned: objects.length, eligible: 0,
    archived: 0, deleted: 0, protectedOrCurrent: 0, changedSinceSnapshot: 0 };
  const protectedKeys = new Set();
  for (const object of objects.filter((item) => /(^|\/)(latest|state|control|update-control)\.json$/.test(item.key))) {
    const content = await client.get(bucket, object.key);
    pointerKeys(JSON.parse(content.body.toString("utf8")), bucket, protectedKeys);
  }
  const candidates = selectObjects(bucket, objects, now, protectedKeys);
  result.protectedOrCurrent = objects.length - candidates.length;
  for (const candidate of candidates.slice(0, LIMITS.changes)) {
    check();
    let content;
    try { content = await client.get(bucket, candidate.key); }
    catch (error) { if (missing(error)) { result.changedSinceSnapshot += 1; continue; } throw error; }
    if (content.etag !== candidate.etag) { result.changedSinceSnapshot += 1; continue; }
    let data = null;
    if (candidate.key.endsWith(".json")) {
      try { data = JSON.parse(content.body.toString("utf8")); }
      catch { result.protectedOrCurrent += 1; continue; }
    }
    if (!terminalObject(candidate.rule, data)) { result.protectedOrCurrent += 1; continue; }
    let bundle = [candidate];
    if (candidate.rule.terminal === "green_evidence") {
      const prefix = candidate.key.slice(0, -"evidence.json".length);
      bundle = objects.filter((item) => item.key.startsWith(prefix));
      // The terminal evidence file is deleted last, so a failed sidecar cleanup
      // remains discoverable and retryable on the next maintenance run.
      bundle.sort((a, b) => Number(a.key === candidate.key) - Number(b.key === candidate.key));
    }
    if (bundle.length > 10 || bundle.some((item) => protectedKeys.has(item.key)
      || !Number.isFinite(Date.parse(item.lastModified)) || Date.parse(item.lastModified) >= now - candidate.rule.days * DAY)) {
      result.protectedOrCurrent += bundle.length; continue;
    }
    result.eligible += bundle.length;
    if (dryRun) continue;
    for (const object of bundle) {
      check();
      const source = object.key === candidate.key ? content : await client.get(bucket, object.key);
      if (source.etag !== object.etag) throw new Error("R2 report changed during archive preparation");
      await archive({ schemaVersion: 1, policyVersion: POLICY_VERSION, kind: "r2", source: { bucket, ...object },
        contentType: source.contentType || null, metadata: source.metadata || {}, encoding: "base64", data: source.body.toString("base64") });
      result.archived += 1;
    }
    let unchanged = true;
    for (const object of bundle) {
      try { if (!await client.unchanged(bucket, object)) unchanged = false; }
      catch (error) { if (missing(error)) unchanged = false; else throw error; }
    }
    if (!unchanged) { result.changedSinceSnapshot += bundle.length; continue; }
    for (const object of bundle) { check(); await client.deleteRetiredReport(bucket, object.key); result.deleted += 1; }
  }
  result.lifecycle = await client.lifecycle(bucket, { apply: !dryRun });
  if (bucket.startsWith("comms-hub")) result.policy = "Comms manager owns history, receipts, audit archives and backup rotation; no blanket TTL";
  if (bucket === "hive") result.policy = "Private archives and durable files retained; only explicitly classified data is eligible";
  if (bucket === "kdp") result.policy = "Current metadata, research state, cooldown history and publication replay barriers retained permanently";
  result.moreCandidates = candidates.length > LIMITS.changes;
  return result;
}

export function createHousekeepingService({ client = null, clock = Date.now, claim = claimDurableLease, release = releaseDurableLease,
  comms = () => getCommsHubContext().housekeepingService.status(), env = process.env } = {}) {
  const activeClient = () => client || new HousekeepingClient(loadCommsHubConfig(env));
  return {
    async status() {
      const storage = activeClient();
      await storage.assertPrivateArchive();
      const latest = await storage.json("housekeeping/latest.json");
      const age = clock() - Date.parse(latest?.completedAt);
      const fresh = Number.isFinite(age) && age >= 0 && age < 8 * DAY;
      return { ok: Boolean(latest?.ok && fresh), fresh, scope: SCOPE, d1: "all_except_KDP", latest,
        schedule: { owner: "MAST", day: "sunday", time: "05:30", timezone: "Europe/London" } };
    },
    async run({ dryRun = true, force = false } = {}) {
      if (!client && (!hasDurableStateEnv(env) || /^(local|file|filesystem)$/i.test(env.STATE_BACKEND || ""))) {
        throw new Error("Governed housekeeping requires durable R2 state");
      }
      const storage = activeClient();
      const started = clock();
      const period = weekKey(new Date(started));
      const runKey = `housekeeping/runs/${period}${dryRun ? "-preview" : ""}.json`;
      const acquired = await claim({ namespace: "storage-housekeeping", key: "account-wide", pendingTtlMs: 30 * 60 * 1000 });
      if (!acquired.claimed) return { ok: false, skipped: true, reason: "already_running" };
      if (acquired.lease.backend !== "r2") { await release(acquired.lease); throw new Error("Local housekeeping leases are forbidden"); }
      let mutations = 0;
      const check = () => { if (clock() - started >= LIMITS.runtimeMs) throw new Error("Housekeeping runtime budget exhausted"); };
      const archive = async (payload) => {
        check();
        if (++mutations > LIMITS.changes) throw new Error("Housekeeping mutation budget exhausted");
        return verifiedArchive(storage, payload);
      };
      const report = { schemaVersion: 1, policyVersion: POLICY_VERSION, runId: randomUUID(), period, dryRun,
        startedAt: new Date(started).toISOString(), ok: false, resources: [], excludedD1: ["KDP"], archiveBucket: ARCHIVE_BUCKET };
      let archiveReady = false;
      let duplicate = false;
      try {
        await storage.assertPrivateArchive();
        archiveReady = true;
        const previous = await storage.json(runKey);
        if (previous?.ok && !force) { duplicate = true; report.ok = true; return { ...previous, skipped: true, reason: "week_complete" }; }
        const databases = await storage.databases();
        const context = { client: storage, archive, check, now: started, dryRun, comms };
        for (const bucket of Object.keys(SCOPE)) {
          check();
          try { report.resources.push({ type: "r2", ...await maintainBucket(bucket, context) }); }
          catch (error) { report.resources.push({ type: "r2", bucket, ok: false, ...failure(error, "bucket_housekeeping_failed") }); }
        }
        for (const database of databases) {
          check();
          try { report.resources.push({ type: "d1", ...await maintainDatabase(database, context) }); }
          catch (error) { report.resources.push({ type: "d1", name: database.name, id: database.uuid, ok: false, ...failure(error, "database_housekeeping_failed") }); }
        }
        report.coverage = { r2: Object.keys(SCOPE).length, d1: databases.length, kdpD1Touched: false };
        report.ok = report.resources.every((resource) => resource.ok);
      } catch (error) {
        report.failure = failure(error, "housekeeping_incomplete");
      } finally {
        report.completedAt = new Date(clock()).toISOString();
        try {
          if (archiveReady && !duplicate) {
            await storage.put(`housekeeping/reports/${report.completedAt.slice(0, 10)}/${report.runId}.json`, bytes(report), { immutable: true });
            await storage.put(runKey, bytes(report));
            await storage.put(dryRun ? "housekeeping/latest-preview.json" : "housekeeping/latest.json", bytes(report));
          }
        } finally { await release(acquired.lease, { ok: report.ok, runId: report.runId }); }
      }
      return report;
    },
  };
}
