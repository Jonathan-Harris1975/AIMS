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

export function getAuditPublishConfig() {
  return {
    bucketAlias: AUDIT_BUCKET_ALIAS,
    bucketEnv: "R2_BUCKET_AUDITS",
    publicBaseEnv: "R2_PUBLIC_BASE_URL_AUDITS",
  };
}

async function putAuditJson(key, payload) {
  const url = await putJson(AUDIT_BUCKET_ALIAS, key, payload);
  return url;
}

async function putAuditText(key, text, contentType = "text/plain") {
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
  return buildPublicUrl(AUDIT_BUCKET_ALIAS, key);
}

export async function cleanupAuditPrefix({ reportPrefix, keepNames = [] }) {
  if (!reportPrefix) return { deleted: [] };
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
  buildAuditPublicUrl,
  publishAuditJson,
  publishAuditText,
  publishAuditRequest,
  publishAuditLatest,
  cleanupAuditPrefix,
};
