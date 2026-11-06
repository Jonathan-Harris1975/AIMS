import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CloudflareBackupClient } from "../comms-hub/clients/cloudflareBackupClient.js";
import { ARCHIVE_BUCKET, LIMITS, REQUIRED_DATABASES, SCOPE, assertObjectScope, canonical, excludedDatabase } from "./policy.js";

export const missing = (error) => error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey";
const lifecycleShape = (rules) => JSON.stringify(canonical([...rules].sort((left, right) => left.id.localeCompare(right.id))));

export class HousekeepingClient {
  constructor(config, { api, s3 } = {}) {
    this.config = config;
    this.api = api || new CloudflareBackupClient(config);
    this.s3 = s3 || new S3Client({
      endpoint: config.r2Endpoint, region: config.r2Region || "auto",
      credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
    });
    this.base = `${config.cloudflareApiBaseUrl}/accounts/${config.cloudflareAccountId}`;
  }

  request(method, path, body) { return this.api.requestApi(method, `${this.base}${path}`, body); }

  async databases() {
    const result = [];
    for (let page = 1; page <= 20; page += 1) {
      const values = await this.request("GET", `/d1/database?page=${page}&per_page=100`);
      if (!Array.isArray(values)) throw new Error("Invalid D1 inventory");
      for (const database of values) {
        if (!database.uuid || !database.name || result.some((item) => item.uuid === database.uuid)) throw new Error("Invalid or repeated D1 inventory page");
        if (!excludedDatabase(database)) result.push(database);
      }
      if (values.length < 100) {
        if (REQUIRED_DATABASES.some((name) => !result.some((database) => database.name === name))) throw new Error("D1 inventory omits required databases");
        return result;
      }
    }
    throw new Error("D1 inventory exceeds housekeeping bound");
  }

  async query(database, sql, params = []) {
    if (excludedDatabase(database)) throw new Error("KDP D1 is excluded from housekeeping");
    const result = await this.request("POST", `/d1/database/${encodeURIComponent(database.uuid)}/query`, { sql, params });
    if (!Array.isArray(result) || result.some((item) => item.success !== true)) throw new Error("D1 housekeeping query failed");
    return result[0]?.results || [];
  }

  async batch(database, statements) {
    if (excludedDatabase(database)) throw new Error("KDP D1 is excluded from housekeeping");
    if (statements.some((statement) => (statement.params || []).length > 100)) throw new Error("D1 parameter limit exceeded");
    const result = await this.request("POST", `/d1/database/${encodeURIComponent(database.uuid)}/query`, { batch: statements });
    if (!Array.isArray(result) || result.length !== statements.length || result.some((item) => item.success !== true)) throw new Error("D1 housekeeping batch failed");
    return result;
  }

  async assertPrivateArchive() {
    const managed = await this.request("GET", `/r2/buckets/${ARCHIVE_BUCKET}/domains/managed`);
    const custom = await this.request("GET", `/r2/buckets/${ARCHIVE_BUCKET}/domains/custom`);
    if (managed.enabled !== false || !Array.isArray(custom.domains) || custom.domains.length) throw new Error("Archive bucket must remain private");
  }

  async list(bucket, prefix) {
    assertObjectScope(bucket, prefix);
    const objects = [];
    let cursor;
    do {
      const response = await this.s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: cursor }));
      for (const object of response.Contents || []) {
        assertObjectScope(bucket, object.Key);
        objects.push({ key: object.Key, size: object.Size, etag: object.ETag, lastModified: object.LastModified?.toISOString() });
      }
      if (objects.length > LIMITS.objects) throw new Error("R2 inventory exceeds housekeeping bound");
      const next = response.IsTruncated ? response.NextContinuationToken : null;
      if (response.IsTruncated && (!next || next === cursor)) throw new Error("R2 inventory pagination is incomplete");
      cursor = next;
    } while (cursor);
    return objects;
  }

  async get(bucket, key, maxBytes = LIMITS.objectBytes) {
    assertObjectScope(bucket, key);
    const response = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (response.ContentLength > maxBytes) { response.Body?.destroy?.(); throw new Error("Housekeeping object exceeds size bound"); }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.Body) {
      size += chunk.length;
      if (size > maxBytes) { response.Body?.destroy?.(); throw new Error("Housekeeping object exceeds size bound"); }
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks), etag: response.ETag, contentType: response.ContentType, metadata: response.Metadata || {} };
  }

  async json(key) {
    try { return JSON.parse((await this.get(ARCHIVE_BUCKET, key, LIMITS.objectBytes * 2)).body.toString("utf8")); }
    catch (error) { if (missing(error)) return null; throw error; }
  }

  async put(key, body, { immutable = false } = {}) {
    if (!key.startsWith("housekeeping/")) throw new Error("Invalid housekeeping archive key");
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: ARCHIVE_BUCKET, Key: key, Body: body, ContentType: "application/json", CacheControl: "no-store, max-age=0",
        ...(immutable ? { IfNoneMatch: "*" } : {}),
      }));
    } catch (error) { if (!immutable || error?.$metadata?.httpStatusCode !== 412) throw error; }
  }

  async unchanged(bucket, object) {
    const response = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    return response.ETag === object.etag && response.ContentLength === object.size;
  }

  async deleteRetiredReport(bucket, key) {
    assertObjectScope(bucket, key);
    // R2 does not enforce conditional DeleteObject. Callers restrict deletion to
    // old terminal report keys, verify the archived bytes and recheck metadata.
    // Mutable state and publication-deduplication records never reach this path.
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async lifecycle(bucket, { apply }) {
    if (!SCOPE[bucket]) throw new Error("Bucket outside housekeeping scope");
    const path = `/r2/buckets/${bucket}/lifecycle`;
    const current = await this.request("GET", path);
    if (!Array.isArray(current.rules)) throw new Error("Invalid R2 lifecycle configuration");
    if (bucket === "kdp") return { ok: true, changed: false, policy: "prefix_only_application_retention" };
    const rules = current.rules.map((rule) => ({ ...rule }));
    const disabled = [];
    for (const rule of rules) {
      if (bucket === "hive-repositories" && rule.enabled && rule.deleteObjectsTransition
        && ((rule.id === "ci-reports-expire-90-days" && rule.conditions?.prefix === "ci-reports/")
          || (rule.id === "rams-council-evidence-expire-90-days" && rule.conditions?.prefix === "Jonathan-Harris1975/RAMS/"))) {
        rule.enabled = false;
        disabled.push(rule.id);
      }
    }
    if (!rules.some((rule) => rule.enabled && !rule.conditions?.prefix && rule.abortMultipartUploadsTransition)) {
      rules.push({ id: "governed-abort-incomplete-uploads-7d", enabled: true, conditions: {},
        abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 604800 } } });
    }
    const changed = lifecycleShape(rules) !== lifecycleShape(current.rules);
    if (apply && changed) {
      await this.request("PUT", path, { rules });
      const verified = await this.request("GET", path);
      if (!Array.isArray(verified.rules) || lifecycleShape(verified.rules) !== lifecycleShape(rules)) throw new Error("Lifecycle read-back mismatch");
    }
    return { ok: true, changed, applied: apply && changed, disabledBroadExpiryRules: disabled, incompleteUploadsDays: 7 };
  }
}
