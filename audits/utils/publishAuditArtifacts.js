import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getAuditBucketName() {
  return cleanEnv("R2_BUCKET_AUDITS");
}

export function getAuditPublicBaseUrl() {
  return trimTrailingSlash(cleanEnv("R2_PUBLIC_BASE_URL_AUDITS"));
}

export function assertAuditR2Config() {
  const bucket = getAuditBucketName();
  const publicBaseUrl = getAuditPublicBaseUrl();
  const missing = [];
  if (!bucket) missing.push("R2_BUCKET_AUDITS");
  if (!publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL_AUDITS");
  if (missing.length) {
    throw new Error(`${missing.join(" and ")} must be configured for audit artefact storage`);
  }
  return { bucket, publicBaseUrl };
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

function artefactUrlsFromPayload(payload = {}) {
  const direct = [
    payload.reportUrl,
    payload.summaryUrl,
    payload.coverageUrl,
    payload.executionUrl,
    payload.preflightUrl,
    payload.evidenceUrl,
    payload.reconciliationUrl,
  ];
  const artefactValues = payload.artefacts && typeof payload.artefacts === "object"
    ? Object.values(payload.artefacts)
    : [];
  return [...direct, ...artefactValues].map(String).map((value) => value.trim()).filter(Boolean);
}

export function assertCompletedAuditArtifactUrls(payload = {}) {
  const { publicBaseUrl } = assertAuditR2Config();
  const urls = artefactUrlsFromPayload(payload);
  if (!urls.length) {
    throw new Error("Completed audit callback did not include any artefact URLs");
  }

  const normalisedBase = normalisePublicUrl(publicBaseUrl);
  const outsideBase = urls.filter((url) => !normalisePublicUrl(url).startsWith(`${normalisedBase}/`));
  if (outsideBase.length) {
    throw new Error(
      `Completed audit artefact URL(s) are outside R2_PUBLIC_BASE_URL_AUDITS: ${outsideBase.join(", ")}`
    );
  }

  return { ok: true, urls, publicBaseUrl: normalisedBase };
}

async function putJson(key, payload) {
  const { bucket } = assertAuditR2Config();
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(payload, null, 2),
    ContentType: "application/json",
  }));
  return buildPublicUrl(key);
}

export async function publishAuditRequest({ auditType, sessionId, payload, reportPrefix }) {
  const key = `${reportPrefix}/request.json`;
  const document = {
    auditType,
    sessionId,
    generatedAt: new Date().toISOString(),
    payload,
  };
  const url = await putJson(key, document);
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
  const url = await putJson(key, document);
  return { key, url };
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
  publishAuditRequest,
  publishAuditLatest,
  cleanupAuditPrefix,
  assertAuditR2Config,
  assertCompletedAuditArtifactUrls,
  getAuditBucketName,
  getAuditPublicBaseUrl,
};
