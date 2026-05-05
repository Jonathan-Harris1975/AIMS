import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const AUDIT_BUCKET_ALIAS = "audits";
const AUDIT_BUCKET_ENV = "R2_BUCKET_AUDITS";
const AUDIT_PUBLIC_BASE_ENV = "R2_PUBLIC_BASE_URL_AUDITS";

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getAuditPublishConfig() {
  return {
    bucketAlias: AUDIT_BUCKET_ALIAS,
    bucketEnv: AUDIT_BUCKET_ENV,
    publicBaseEnv: AUDIT_PUBLIC_BASE_ENV,
    bucketName: getAuditBucketName(),
    publicBaseUrl: getAuditPublicBaseUrl(),
  };
}

export function getAuditBucketName() {
  return cleanEnv(AUDIT_BUCKET_ENV);
}

export function getAuditPublicBaseUrl() {
  return trimTrailingSlash(cleanEnv(AUDIT_PUBLIC_BASE_ENV));
}

export function assertAuditR2Config() {
  const bucket = getAuditBucketName();
  const publicBaseUrl = getAuditPublicBaseUrl();
  const missing = [];
  if (!bucket) missing.push(AUDIT_BUCKET_ENV);
  if (!publicBaseUrl) missing.push(AUDIT_PUBLIC_BASE_ENV);
  if (missing.length) {
    throw new Error(`${missing.join(" and ")} must be configured for audit artefact storage`);
  }
  return { bucket, publicBaseUrl, bucketAlias: AUDIT_BUCKET_ALIAS };
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

function buildPublicUrl(key) {
  const { publicBaseUrl } = assertAuditR2Config();
  return `${publicBaseUrl}/${key}`;
}

function normalisePublicUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
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
    payload.summaryUrl,
    payload.coverageUrl,
    payload.executionUrl,
    payload.preflightUrl,
    payload.evidenceUrl,
    payload.reconciliationUrl,
    payload.reportJsonUrl,
    payload.reportHtmlUrl,
    payload.latestUrl,
  ];
  const artefactValues = payload.artefacts && typeof payload.artefacts === "object"
    ? flattenArtefactValues(payload.artefacts)
    : [];
  return [...direct, ...artefactValues]
    .filter(isUsableArtefactUrl)
    .map((value) => String(value).trim());
}

export function assertAuditArtifactUrls(payload = {}, { requireAny = true } = {}) {
  const { publicBaseUrl } = assertAuditR2Config();
  const urls = artefactUrlsFromPayload(payload);
  if (requireAny && !urls.length) {
    throw new Error("Completed audit callback did not include any artefact URLs");
  }

  const normalisedBase = normalisePublicUrl(publicBaseUrl);
  const outsideBase = urls.filter((url) => !normalisePublicUrl(url).startsWith(`${normalisedBase}/`));
  if (outsideBase.length) {
    throw new Error(
      `Audit artefact URL(s) are outside ${AUDIT_PUBLIC_BASE_ENV}: ${outsideBase.join(", ")}`
    );
  }

  return { ok: true, urls, publicBaseUrl: normalisedBase };
}

export function assertCompletedAuditArtifactUrls(payload = {}) {
  return assertAuditArtifactUrls(payload, { requireAny: true });
}

async function putObject({ key, body, contentType }) {
  const { bucket } = assertAuditR2Config();
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return { key, url: buildPublicUrl(key), bucketAlias: AUDIT_BUCKET_ALIAS };
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

export async function publishAuditRequest({ auditType, sessionId, payload, reportPrefix }) {
  const key = `${reportPrefix}/request.json`;
  const document = {
    auditType,
    sessionId,
    generatedAt: new Date().toISOString(),
    payload,
  };
  const published = await putJson(key, document);
  return { key, url: published.url };
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
  return { key, url: published.url };
}

export async function cleanupAuditPrefix({ reportPrefix, keepNames = [] }) {
  if (!reportPrefix) return { deleted: [] };
  const { bucket } = assertAuditR2Config();
  const keep = new Set(keepNames);
  const client = getClient();
  let continuationToken;
  const keysToDelete = [];

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${reportPrefix.replace(/\/$/, "")}/`,
      ContinuationToken: continuationToken,
    }));

    for (const item of response.Contents || []) {
      const key = item.Key || "";
      if (!key) continue;
      const leaf = key.split("/").pop() || "";
      if (!keep.has(leaf)) {
        keysToDelete.push({ Key: key });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!keysToDelete.length) {
    return { deleted: [] };
  }

  await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: keysToDelete, Quiet: true },
  }));

  return { deleted: keysToDelete.map((item) => item.Key) };
}

export default {
  publishAuditJson,
  publishAuditText,
  publishAuditRequest,
  publishAuditLatest,
  cleanupAuditPrefix,
  assertAuditR2Config,
  assertAuditArtifactUrls,
  assertCompletedAuditArtifactUrls,
  getAuditBucketName,
  getAuditPublicBaseUrl,
  getAuditPublishConfig,
};
