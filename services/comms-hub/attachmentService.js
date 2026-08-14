import { CommsHubError } from './errors.js';
import { sha256Hex, stableId } from './domain/ids.js';

function safeFilename(value) {
  return String(value || 'attachment.bin').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'attachment.bin';
}

export class CommsHubAttachmentService {
  constructor({ context, fetchImpl = globalThis.fetch }) {
    this.context = context;
    this.fetchImpl = fetchImpl;
  }

  assertReady() {
    if (!this.context.privateR2 || !this.context.config?.r2PrivateBucketName) {
      throw new CommsHubError(503, 'attachment_storage_unconfigured', 'R2_BUCKET_COMMS_HUB_PRIVATE is not configured.', {
        failureClass: 'permanent',
        publicMessage: 'Private attachment storage is not configured.',
      });
    }
    if (!this.context.malwareScanner || !this.context.config?.attachmentScannerUrl || !this.context.config?.attachmentScannerToken) {
      throw new CommsHubError(503, 'attachment_scanner_unconfigured', 'Attachment malware scanning is not configured.', {
        failureClass: 'permanent',
        publicMessage: 'Attachment scanning is not configured.',
      });
    }
  }

  async download(url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new CommsHubError(400, 'attachment_url_invalid', 'Attachment URL is invalid.'); }
    if (parsed.protocol !== 'https:') throw new CommsHubError(400, 'attachment_url_insecure', 'Attachment URL must use HTTPS.');
    const response = await this.fetchImpl(parsed, { signal: AbortSignal.timeout(this.context.config.attachmentDownloadTimeoutMs) });
    if (!response.ok) throw new CommsHubError(502, 'attachment_download_failed', `Attachment download returned ${response.status}.`, { retryable: response.status >= 500, failureClass: response.status >= 500 ? 'temporary' : 'recoverable' });
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > this.context.config.attachmentMaxBytes) throw new CommsHubError(413, 'attachment_too_large', 'Attachment exceeds the configured size limit.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > this.context.config.attachmentMaxBytes) throw new CommsHubError(413, 'attachment_too_large', 'Attachment exceeds the configured size limit.');
    return { buffer, contentType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
  }

  async ingest({ attachmentId, filename, contentType, buffer, provider = 'direct', metadata = {} }) {
    this.assertReady();
    const storedFilename = safeFilename(filename);
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (!body.length) throw new CommsHubError(400, 'attachment_empty', 'Attachment is empty.');
    if (body.length > this.context.config.attachmentMaxBytes) throw new CommsHubError(413, 'attachment_too_large', 'Attachment exceeds the configured size limit.');
    const sha256 = sha256Hex(body);
    const scan = await this.context.malwareScanner.scan({ buffer: body, filename: storedFilename, contentType });
    const storedAt = new Date().toISOString();
    const objectKey = `attachments/${storedAt.slice(0, 10)}/${attachmentId}/${sha256.slice(0, 16)}-${storedFilename}`;
    if (!scan.clean) {
      await this.context.operationsRepository.recordAttachmentObject({ id: stableId('aob', attachmentId), attachmentId, bucketName: this.context.config.r2PrivateBucketName, objectKey, sha256, sizeBytes: body.length, contentType, scanStatus: 'infected', scanProvider: scan.provider, scanReference: scan.reference, scannedAt: storedAt, storedAt, metadata: { ...metadata, findings: scan.findings } });
      await this.context.d1.query(`UPDATE comms_hub_attachments SET status = 'quarantined' WHERE id = ?`, [attachmentId]);
      throw new CommsHubError(422, 'attachment_infected', 'Attachment failed malware scanning.', { failureClass: 'permanent' });
    }
    const stored = await this.context.privateR2.putBuffer(objectKey, body, contentType, { sha256, attachment_id: attachmentId });
    const record = await this.context.operationsRepository.recordAttachmentObject({ id: stableId('aob', attachmentId), attachmentId, bucketName: stored.bucket, objectKey: stored.key, sha256, sizeBytes: stored.size, contentType, scanStatus: 'clean', scanProvider: scan.provider, scanReference: scan.reference, scannedAt: storedAt, storedAt, metadata });
    await this.context.d1.query(`UPDATE comms_hub_attachments SET status = 'stored' WHERE id = ?`, [attachmentId]);
    await this.context.operationsRepository.indexSearchDocument({ id: stableId('srch', 'attachment', attachmentId), objectType: 'attachment', objectId: attachmentId, conversationId: metadata.conversationId || null, contactId: metadata.contactId || null, channel: metadata.channel || null, searchableText: `${storedFilename} ${contentType} ${provider}`, metadata: { sha256, sizeBytes: body.length }, updatedAt: storedAt });
    return record;
  }

  async ingestReference({ attachmentId, providerUrl, filename, contentType = 'application/octet-stream', provider = 'remote', metadata = {} }) {
    const downloaded = await this.download(providerUrl);
    return this.ingest({ attachmentId, filename, contentType: downloaded.contentType || contentType, buffer: downloaded.buffer, provider, metadata });
  }

  async get(attachmentId) {
    const record = await this.context.operationsRepository.getAttachmentObject(attachmentId);
    if (!record || record.scan_status !== 'clean' || record.deleted_at) throw new CommsHubError(404, 'attachment_unavailable', 'Attachment is unavailable.');
    const buffer = await this.context.privateR2.getBuffer(record.object_key);
    if (sha256Hex(buffer) !== record.sha256) throw new CommsHubError(409, 'attachment_checksum_mismatch', 'Attachment integrity validation failed.');
    return { record, buffer };
  }

  async createDirect({ messageId, filename, contentType, buffer, provider = 'direct', metadata = {} }) {
    if (!messageId) throw new CommsHubError(400, 'attachment_message_required', 'A parent message is required for direct attachment ingestion.');
    const attachmentId = stableId('att', provider, messageId, filename, sha256Hex(buffer));
    await this.context.operationsRepository.ensureAttachmentReference({
      id: attachmentId,
      messageId,
      provider,
      filename: safeFilename(filename),
      status: 'pending',
      metadata,
    });
    return this.ingest({ attachmentId, filename: safeFilename(filename), contentType, buffer, provider, metadata });
  }
}

export default CommsHubAttachmentService;
