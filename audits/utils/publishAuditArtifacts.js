import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
  return `${BRAND_ASSETS_PUBLIC_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`;
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

export async function cleanupAuditPrefix({ reportPrefix, keepRelativePaths = [] }) {
  const client = getClient();
  const keepKeys = new Set(
    keepRelativePaths
      .map((relativePath) => String(relativePath || "").trim())
      .filter(Boolean)
      .map((relativePath) => `${reportPrefix.replace(/\/$/, "")}/${relativePath.replace(/^\//, "")}`)
  );

  let continuationToken;
  const toDelete = [];

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: BRAND_ASSETS_BUCKET,
      Prefix: `${reportPrefix.replace(/\/$/, "")}/`,
      ContinuationToken: continuationToken,
    }));

    for (const item of response.Contents || []) {
      if (!item?.Key) continue;
      if (keepKeys.has(item.Key)) continue;
      toDelete.push({ Key: item.Key });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!toDelete.length) {
    return { deletedCount: 0 };
  }

  while (toDelete.length) {
    const batch = toDelete.splice(0, 1000);
    await client.send(new DeleteObjectsCommand({
      Bucket: BRAND_ASSETS_BUCKET,
      Delete: { Objects: batch, Quiet: true },
    }));
  }

  return { deletedCount: toDelete.length };
}

export default {
  publishAuditRequest,
  publishAuditLatest,
  cleanupAuditPrefix,
};
