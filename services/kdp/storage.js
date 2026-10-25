import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getObjectAsBuffer, getObjectAsText, putPrivateJson, buildR2Reference, normaliseR2ObjectKey } from "../shared/utils/r2-client.js";

const MAX_KDP_CONTENT_BYTES = Number(process.env.KDP_CONTENT_MAX_BYTES || 200 * 1024 * 1024);

export async function downloadKdpObjectToTempFile(key, { expectedPrefix = "", suffix = ".pdf" } = {}) {
  const safeKey = normaliseR2ObjectKey(key, { label: "KDP R2 object key" });
  if (expectedPrefix && !safeKey.startsWith(expectedPrefix)) {
    const error = new Error(`KDP content key must start with '${expectedPrefix}'.`);
    error.statusCode = 400;
    error.code = "invalid_kdp_content_key";
    throw error;
  }
  const buffer = await getObjectAsBuffer("kdp", safeKey, { maxBytes: MAX_KDP_CONTENT_BYTES });
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("The KDP content object is empty.");
    error.statusCode = 422;
    error.code = "kdp_content_empty";
    throw error;
  }
  if (buffer.length > MAX_KDP_CONTENT_BYTES) {
    const error = new Error("The KDP content object exceeds the configured upload limit.");
    error.statusCode = 413;
    error.code = "kdp_content_too_large";
    throw error;
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aims-kdp-content-"));
  await fs.chmod(directory, 0o700);
  const filePath = path.join(directory, `${randomUUID()}${suffix}`);
  await fs.writeFile(filePath, buffer, { mode: 0o600, flag: "wx" });
  return {
    filePath,
    async cleanup() { await fs.rm(directory, { recursive: true, force: true }); },
  };
}

export async function persistKdpMetadata(cache) {
  const key = "metadata/latest.json";
  await putPrivateJson("kdp", key, cache);
  return buildR2Reference("kdp", key);
}

export async function readKdpMetadataSnapshot() {
  try {
    return JSON.parse(await getObjectAsText("kdp", "metadata/latest.json"));
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function persistKdpAuditReport(report) {
  const date = new Date(report.createdAt || Date.now()).toISOString().slice(0, 10);
  const key = `audit/reports/${date}/${report.runId}.json`;
  await putPrivateJson("kdp", key, report);
  return buildR2Reference("kdp", key);
}

export async function readKdpAuditReport(key) {
  const safeKey = normaliseR2ObjectKey(key, { label: "KDP audit report key" });
  if (!safeKey.startsWith("audit/reports/")) {
    const error = new Error("Audit report key is outside the KDP audit reports prefix.");
    error.statusCode = 400;
    error.code = "invalid_kdp_audit_report_key";
    throw error;
  }
  return JSON.parse(await getObjectAsText("kdp", safeKey));
}

export async function persistKdpRoyaltyReport(filename, buffer, metadata = {}) {
  const key = `reports/royalties/${filename}`;
  await putPrivateJson("kdp", `${key}.json`, metadata);
  const { uploadPrivateBuffer } = await import("../shared/utils/r2-client.js");
  await uploadPrivateBuffer("kdp", key, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return buildR2Reference("kdp", key);
}

export const __kdpStorageTestHooks = { MAX_KDP_CONTENT_BYTES };
