import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const BRAND_ASSETS_BUCKET = String(process.env.R2_BUCKET_BRAND_ASSETS || "brand-assets").trim();
const BRAND_ASSETS_PUBLIC_BASE = String(process.env.R2_PUBLIC_BASE_URL_BRAND_ASSETS || "").trim().replace(/\/$/, "");

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
  if (!BRAND_ASSETS_PUBLIC_BASE) {
    throw new Error("R2_PUBLIC_BASE_URL_BRAND_ASSETS is required for audit publishing");
  }
  return `${BRAND_ASSETS_PUBLIC_BASE}/${key}`;
}

async function putJson(key, payload) {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: BRAND_ASSETS_BUCKET,
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
  const keep = new Set(keepNames);
  const client = getClient();
  let continuationToken;
  const keysToDelete = [];

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: BRAND_ASSETS_BUCKET,
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
    Bucket: BRAND_ASSETS_BUCKET,
    Delete: { Objects: keysToDelete, Quiet: true },
  }));

  return { deleted: keysToDelete.map((item) => item.Key) };
}

export default {
  publishAuditRequest,
  publishAuditLatest,
  cleanupAuditPrefix,
};
