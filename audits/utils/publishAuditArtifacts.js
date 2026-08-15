import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const AUDIT_BUCKET_ALIAS = "audits";
const AUDIT_BUCKET_ENV = "R2_BUCKET_AUDITS";

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function normaliseAuditKey(value) {
  const key = String(value || "").trim().replace(/^\/+/, "");
  if (!key || key.includes("..") || /[?#\x00-\x1f\x7f]/.test(key)) return "";
  return key;
}

export function getAuditPublishConfig() {
  const bucketName = getAuditBucketName();
  return {
    bucketAlias: AUDIT_BUCKET_ALIAS,
    bucketEnv: AUDIT_BUCKET_ENV,
    publicBaseEnv: null,
    bucketName,
    publicBaseUrl: null,
    accessMode: "private-r2",
    storageUri: bucketName ? `r2://${bucketName}` : null,
  };
}

export function getAuditBucketName() {
  return cleanEnv(AUDIT_BUCKET_ENV);
}

export function getAuditPublicBaseUrl() {
  return "";
}

export function assertAuditR2Config() {
  const bucket = getAuditBucketName();
  if (!bucket) {
    throw new Error(`${AUDIT_BUCKET_ENV} must be configured for private audit artefact storage`);
  }
  return {
    bucket,
    publicBaseUrl: null,
    bucketAlias: AUDIT_BUCKET_ALIAS,
    accessMode: "private-r2",
    storageUri: `r2://${bucket}`,
  };
}

function getClient() {
  return new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function buildPrivateReference(key) {
  const { bucket } = assertAuditR2Config();
  const cleanKey = normaliseAuditKey(key);
  if (!cleanKey) throw new Error("Invalid audit artefact object key");
  return `r2://${bucket}/${cleanKey}`;
}

function isUsableArtefactUrl(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  return !["undefined", "null", "false"].includes(text.toLowerCase());
}

function flattenArtefactValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenArtefactValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenArtefactValues);
  return [value];
}

function artefactUrlsFromPayload(payload = {}) {
  const direct = [
    payload.reportUrl,
    payload.reportHtmlUrl,
    payload.reportJsonUrl,
    payload.summaryUrl,
    payload.coverageUrl,
    payload.executionUrl,
    payload.preflightUrl,
    payload.evidenceUrl,
    payload.reconciliationUrl,
    payload.screenshotManifestUrl,
    payload.focusedPageAppendixUrl,
    payload.repositoryIssueAppendixUrl,
    payload.mandatoryMobileScorecardUrl,
    payload.responsiveFixAppendixUrl,
    payload.latestUrl,
  ];
  const artefactValues = payload.artefacts && typeof payload.artefacts === "object"
    ? flattenArtefactValues(payload.artefacts)
    : [];
  return [...direct, ...artefactValues]
    .filter(isUsableArtefactUrl)
    .map((value) => String(value).trim());
}

// Legacy HTTP-shaped callback values are accepted only as object-key carriers.
// AIMS never fetches them anonymously; it extracts the key and reads private R2.
export function auditKeyFromPublicUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const { bucket } = assertAuditR2Config();

  if (text.startsWith("r2://")) {
    const prefix = `r2://${bucket}/`;
    if (!text.startsWith(prefix)) return "";
    return normaliseAuditKey(text.slice(prefix.length));
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      const key = normaliseAuditKey(decodeURIComponent(parsed.pathname).replace(/^\/+/, ""));
      return key.startsWith("audits/") ? key : "";
    } catch {
      return "";
    }
  }

  return normaliseAuditKey(text);
}

export function assertAuditArtifactUrls(payload = {}, { requireAny = true } = {}) {
  const { bucket } = assertAuditR2Config();
  const locations = artefactUrlsFromPayload(payload);
  if (requireAny && !locations.length) {
    throw new Error("Completed audit callback did not include any artefact references");
  }

  const invalid = locations.filter((location) => {
    const key = auditKeyFromPublicUrl(location);
    return !key || !key.startsWith("audits/");
  });
  if (invalid.length) {
    throw new Error(`Audit artefact reference(s) are outside private R2 bucket ${bucket}: ${invalid.join(", ")}`);
  }

  return {
    ok: true,
    urls: locations,
    references: locations,
    bucket,
    accessMode: "private-r2",
  };
}

export function assertCompletedAuditArtifactUrls(payload = {}) {
  return assertAuditArtifactUrls(payload, { requireAny: true });
}

async function bodyToString(body) {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function readAuditText({ key }) {
  const cleanKey = normaliseAuditKey(key);
  if (!cleanKey) throw new Error("readAuditText requires a valid key");
  const { bucket } = assertAuditR2Config();
  const client = getClient();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: cleanKey }));
  return bodyToString(response.Body);
}

export async function readAuditJson({ key }) {
  const text = await readAuditText({ key });
  return JSON.parse(text);
}

async function putObject({ key, body, contentType }) {
  const cleanKey = normaliseAuditKey(key);
  if (!cleanKey) throw new Error("Audit publish requires a valid key");
  const { bucket } = assertAuditR2Config();
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: cleanKey,
    Body: body,
    ContentType: contentType,
    CacheControl: "no-store, max-age=0",
  }));
  const uri = buildPrivateReference(cleanKey);
  return { key: cleanKey, url: uri, uri, bucketAlias: AUDIT_BUCKET_ALIAS };
}

async function putJson(key, payload) {
  return putObject({
    key,
    body: JSON.stringify(payload, null, 2),
    contentType: "application/json; charset=utf-8",
  });
}

export async function publishAuditJson({ key, payload }) {
  if (!key) throw new Error("publishAuditJson requires key");
  return putJson(key, payload);
}

export async function publishAuditText({ key, text, contentType = "text/plain; charset=utf-8" }) {
  if (!key) throw new Error("publishAuditText requires key");
  return putObject({ key, body: String(text ?? ""), contentType });
}

export async function publishAuditBuffer({ key, body, contentType = "application/octet-stream" }) {
  if (!key) throw new Error("publishAuditBuffer requires key");
  if (!(body instanceof Uint8Array) && !Buffer.isBuffer(body)) {
    throw new Error("publishAuditBuffer requires a Buffer or Uint8Array body");
  }
  return putObject({ key, body, contentType });
}

export async function publishAuditRequest({ auditType, sessionId, payload, reportPrefix }) {
  const key = `${reportPrefix}/request.json`;
  const document = {
    auditType,
    sessionId,
    generatedAt: new Date().toISOString(),
    payload,
  };
  const published = await putJson(key, document);
  return { key, url: published.url, uri: published.uri };
}

export async function publishAuditLatest({ auditType, sessionId, payload }) {
  const key = `audits/${auditType}/latest.json`;
  const document = {
    auditType,
    sessionId,
    updatedAt: new Date().toISOString(),
    ...payload,
  };
  const published = await putJson(key, document);
  return { key, url: published.url, uri: published.uri };
}

function normaliseKeepPrefix(value) {
  const cleaned = String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return cleaned ? `${cleaned}/` : "";
}

function shouldKeepAuditKey({ key, prefixRoot, keepNames, keepPrefixes }) {
  const relative = key.slice(prefixRoot.length);
  const leaf = relative.split("/").pop() || "";
  if (keepNames.has(leaf)) return true;
  return keepPrefixes.some((prefix) => relative.startsWith(prefix));
}

export async function cleanupAuditPrefix({ reportPrefix, keepNames = [], keepPrefixes = [] }) {
  if (!reportPrefix) return { deleted: [] };
  const { bucket } = assertAuditR2Config();
  const keep = new Set(keepNames);
  const preservedPrefixes = keepPrefixes.map(normaliseKeepPrefix).filter(Boolean);
  const client = getClient();
  let continuationToken;
  const keysToDelete = [];
  const prefixRoot = `${reportPrefix.replace(/\/$/, "")}/`;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefixRoot,
      ContinuationToken: continuationToken,
    }));

    for (const item of response.Contents || []) {
      const key = item.Key || "";
      if (!key) continue;
      if (!shouldKeepAuditKey({ key, prefixRoot, keepNames: keep, keepPrefixes: preservedPrefixes })) {
        keysToDelete.push({ Key: key });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!keysToDelete.length) {
    return { deleted: [], remaining: [] };
  }

  const deleted = [];
  for (let index = 0; index < keysToDelete.length; index += 1000) {
    const batch = keysToDelete.slice(index, index + 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch, Quiet: true },
    }));
    deleted.push(...batch.map((item) => item.Key));
  }

  const remaining = [];
  continuationToken = undefined;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefixRoot,
      ContinuationToken: continuationToken,
    }));
    for (const item of response.Contents || []) {
      const key = item.Key || "";
      if (!key) continue;
      if (!shouldKeepAuditKey({ key, prefixRoot, keepNames: keep, keepPrefixes: preservedPrefixes })) {
        remaining.push(key);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (remaining.length) {
    const err = new Error(`Audit cleanup left ${remaining.length} object(s) under ${reportPrefix}`);
    err.remainingKeys = remaining.slice(0, 50);
    throw err;
  }

  return { deleted, remaining };
}

export default {
  publishAuditJson,
  publishAuditText,
  publishAuditBuffer,
  publishAuditRequest,
  publishAuditLatest,
  readAuditJson,
  readAuditText,
  auditKeyFromPublicUrl,
  cleanupAuditPrefix,
  assertAuditR2Config,
  assertAuditArtifactUrls,
  assertCompletedAuditArtifactUrls,
  getAuditBucketName,
  getAuditPublicBaseUrl,
  getAuditPublishConfig,
};
