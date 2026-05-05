import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  buildPublicUrl,
  ensureBucketKey,
  putJson,
  s3,
  uploadText,
} from "../../services/shared/utils/r2-client.js";

export const AUDIT_BUCKET_ALIAS = "audits";
const AUDIT_BUCKET_ENV = "R2_BUCKET_AUDITS";
const AUDIT_PUBLIC_BASE_ENV = "R2_PUBLIC_BASE_URL_AUDITS";

export function getAuditPublishConfig() {
  return {
    bucketAlias: AUDIT_BUCKET_ALIAS,
    bucketEnv: AUDIT_BUCKET_ENV,
    publicBaseEnv: AUDIT_PUBLIC_BASE_ENV,
  };
}

function cleanPublicBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getAuditPublicBaseUrl() {
  return cleanPublicBase(process.env[AUDIT_PUBLIC_BASE_ENV]);
}

export function getAuditBucketName() {
  return String(process.env[AUDIT_BUCKET_ENV] || "").trim();
}

export function assertAuditR2Config() {
  const bucket = getAuditBucketName();
  const publicBaseUrl = getAuditPublicBaseUrl();

  if (!bucket) {
    throw new Error(`${AUDIT_BUCKET_ENV} is required. Audit artefacts must be stored in the dedicated audits bucket.`);
  }
  if (!publicBaseUrl) {
    throw new Error(`${AUDIT_PUBLIC_BASE_ENV} is required. Audit artefact URLs must resolve from the dedicated audits public base URL.`);
  }

  return { bucket, publicBaseUrl };
}

export function isAuditPublicUrl(url) {
  const publicBaseUrl = getAuditPublicBaseUrl();
  const candidate = String(url || "").trim();
  if (!candidate || !publicBaseUrl) return false;
  return candidate === publicBaseUrl || candidate.startsWith(`${publicBaseUrl}/`);
}

function auditArtifactUrlEntries(payload = {}) {
  const entries = [];
  for (const field of ["reportUrl", "summaryUrl", "coverageUrl", "executionUrl", "preflightUrl", "evidenceUrl", "reconciliationUrl"]) {
    if (payload[field]) entries.push([field, payload[field]]);
  }
  for (const [name, value] of Object.entries(payload.artefacts || {})) {
    if (value) entries.push([`artefacts.${name}`, value]);
  }
  return entries;
}

export function assertAuditArtifactUrls(payload = {}, { requireAny = false } = {}) {
  const { publicBaseUrl } = assertAuditR2Config();
  const entries = auditArtifactUrlEntries(payload);

  if (requireAny && !entries.length) {
    throw new Error(`Completed audit callback did not include any artefact URLs. Refusing to mark complete because audit data must be published to ${AUDIT_BUCKET_ENV} and exposed from ${AUDIT_PUBLIC_BASE_ENV} (${publicBaseUrl}).`);
  }

  const invalid = entries.filter(([, value]) => !isAuditPublicUrl(value));
  if (invalid.length) {
    const detail = invalid.map(([name, value]) => `${name}=${value}`).join("; ");
    throw new Error(`Audit artefact callback contains URL(s) outside ${AUDIT_PUBLIC_BASE_ENV} (${publicBaseUrl}). Audit data must only be stored on ${AUDIT_BUCKET_ENV}. Invalid: ${detail}`);
  }
}

export function assertCompletedAuditArtifactUrls(payload = {}) {
  return assertAuditArtifactUrls(payload, { requireAny: true });
}

async function putAuditJson(key, payload) {
  assertAuditR2Config();
  const url = await putJson(AUDIT_BUCKET_ALIAS, key, payload);
  return url;
}

async function putAuditText(key, text, contentType = "text/plain") {
  assertAuditR2Config();
  return uploadText(AUDIT_BUCKET_ALIAS, key, text, contentType);
}

export async function publishAuditJson({ key, payload }) {
  const url = await putAuditJson(key, payload);
  return { key, url };
}

export async function publishAuditText({ key, text, contentType = "text/plain" }) {
  const url = await putAuditText(key, text, contentType);
  return { key, url };
}

export async function publishAuditRequest({ auditType, sessionId, payload, reportPrefix }) {
  const key = `${reportPrefix}/request.json`;
  const document = {
    auditType,
    sessionId,
    generatedAt: new Date().toISOString(),
    payload,
  };
  const url = await putAuditJson(key, document);
  return { key, url };
}

export async function publishAuditLatest({ auditType, sessionId, payload }) {
  const key = `audits/${auditType}/latest.json`;
  const document = {
    auditType,
    sessionId,
    updatedAt: new Date().toISOString(),
    ...payload,
  };
  const url = await putAuditJson(key, document);
  return { key, url };
}

export function buildAuditPublicUrl(key) {
  assertAuditR2Config();
  return buildPublicUrl(AUDIT_BUCKET_ALIAS, key);
}

export async function cleanupAuditPrefix({ reportPrefix, keepNames = [] }) {
  if (!reportPrefix) return { deleted: [] };
  assertAuditR2Config();
  const keep = new Set(keepNames);
  const bucket = ensureBucketKey(AUDIT_BUCKET_ALIAS);
  let continuationToken;
  const keysToDelete = [];

  do {
    const response = await s3.send(new ListObjectsV2Command({
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

  await s3.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: keysToDelete, Quiet: true },
  }));

  return { deleted: keysToDelete.map((item) => item.Key) };
}

export default {
  AUDIT_BUCKET_ALIAS,
  getAuditPublishConfig,
  getAuditPublicBaseUrl,
  getAuditBucketName,
  assertAuditR2Config,
  assertAuditArtifactUrls,
  assertCompletedAuditArtifactUrls,
  isAuditPublicUrl,
  buildAuditPublicUrl,
  publishAuditJson,
  publishAuditText,
  publishAuditRequest,
  publishAuditLatest,
  cleanupAuditPrefix,
};
