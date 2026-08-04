import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { CommsHubError } from "../errors.js";
import { sha256Hex } from "../domain/ids.js";

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export class PrivateR2Client {
  constructor(config, { client } = {}) {
    this.config = config;
    this.bucket = config.r2PrivateBucketName;
    this.client = client || new S3Client({
      region: config.r2Region || "auto",
      endpoint: config.r2Endpoint,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  assertConfigured() {
    if (!this.bucket) {
      throw new CommsHubError(503, "private_r2_unconfigured", "R2_BUCKET_COMMS_HUB_PRIVATE is not configured.", {
        failureClass: "permanent",
        publicMessage: "Private object storage is not configured.",
      });
    }
  }

  async putBuffer(key, buffer, contentType = "application/octet-stream", metadata = {}) {
    this.assertConfigured();
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "no-store, max-age=0",
      Metadata: Object.fromEntries(Object.entries(metadata).map(([name, value]) => [name, String(value)])),
    }));
    return { bucket: this.bucket, key, size: body.length, sha256: sha256Hex(body) };
  }

  async putText(key, value, contentType = "text/plain; charset=utf-8", metadata = {}) {
    return this.putBuffer(key, Buffer.from(String(value), "utf8"), contentType, metadata);
  }

  async getBuffer(key) {
    this.assertConfigured();
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return bodyToBuffer(response.Body);
  }

  async head(key) {
    this.assertConfigured();
    const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      key,
      size: Number(response.ContentLength || 0),
      etag: String(response.ETag || "").replace(/^"|"$/g, ""),
      metadata: response.Metadata || {},
    };
  }

  async delete(key) {
    this.assertConfigured();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return { bucket: this.bucket, key, deleted: true };
  }

  async list(prefix = "") {
    this.assertConfigured();
    const objects = [];
    let continuationToken;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const object of response.Contents || []) {
        objects.push({
          key: String(object.Key || ""),
          size: Number(object.Size || 0),
          etag: String(object.ETag || "").replace(/^"|"$/g, ""),
          lastModified: object.LastModified ? new Date(object.LastModified).toISOString() : null,
        });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }
}

export default PrivateR2Client;
