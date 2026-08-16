import { CommsHubError } from './errors.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { sha256Hex, stableId } from './domain/ids.js';

function safeFilename(value) {
  return String(value || 'attachment.bin').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'attachment.bin';
}

function isPrivateOrSpecialIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51)
    || (a === 203 && b === 0)
    || a >= 224;
}

function isPrivateOrSpecialIp(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(value);
  if (family === 4) return isPrivateOrSpecialIpv4(value);
  if (family !== 6) return false;
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateOrSpecialIpv4(mapped[1]) : false;
}

function assertAttachmentHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    throw new CommsHubError(400, 'attachment_url_private_target', 'Attachment URL may not target a local or private host.', { failureClass: 'permanent' });
  }
  if (isIP(host) && isPrivateOrSpecialIp(host)) {
    throw new CommsHubError(400, 'attachment_url_private_target', 'Attachment URL may not target a private or special-use IP address.', { failureClass: 'permanent' });
  }
}

export class CommsHubAttachmentService {
  constructor({ context, fetchImpl = globalThis.fetch, lookupImpl = null }) {
    this.context = context;
    this.fetchImpl = fetchImpl;
    // Production uses the Node resolver to prevent hostname-to-private-network attachment fetches.
    // Tests/custom transports can inject a resolver explicitly without causing real DNS traffic.
    this.lookupImpl = lookupImpl || (fetchImpl === globalThis.fetch ? dnsLookup : null);
  }

  async assertPublicAttachmentUrl(url) {
    let parsed;
    try { parsed = url instanceof URL ? url : new URL(url); } catch { throw new CommsHubError(400, 'attachment_url_invalid', 'Attachment URL is invalid.'); }
    if (parsed.protocol !== 'https:') throw new CommsHubError(400, 'attachment_url_insecure', 'Attachment URL must use HTTPS.');
    if (parsed.username || parsed.password) throw new CommsHubError(400, 'attachment_url_credentials_forbidden', 'Attachment URL may not contain embedded credentials.');
    assertAttachmentHostname(parsed.hostname);
    if (this.lookupImpl && !isIP(parsed.hostname)) {
      let addresses;
      try { addresses = await this.lookupImpl(parsed.hostname, { all: true, verbatim: true }); }
      catch (cause) {
        throw new CommsHubError(502, 'attachment_host_resolution_failed', 'Attachment host could not be resolved.', { cause, retryable: true, failureClass: 'temporary' });
      }
      const resolved = Array.isArray(addresses) ? addresses : [addresses];
      if (!resolved.length || resolved.some((item) => isPrivateOrSpecialIp(item?.address))) {
        throw new CommsHubError(400, 'attachment_url_private_target', 'Attachment URL resolves to a private or special-use network address.', { failureClass: 'permanent' });
      }
    }
    return parsed;
  }

  assertReady() {
    if (!this.context.privateR2 || !this.context.config?.r2PrivateBucketName) {
      throw new CommsHubError(503, 'attachment_storage_unconfigured', 'R2_BUCKET_COMMS_HUB_PRIVATE is not configured.', {
        failureClass: 'permanent',
        publicMessage: 'Private attachment storage is not configured.',
      });
    }
  }

  async download(url) {
    let current = await this.assertPublicAttachmentUrl(url);
    const maximumRedirects = 3;
    for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
      const response = await this.fetchImpl(current, {
        signal: AbortSignal.timeout(this.context.config.attachmentDownloadTimeoutMs),
        redirect: 'manual',
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= maximumRedirects) throw new CommsHubError(502, 'attachment_redirect_limit', 'Attachment download exceeded the redirect limit.', { failureClass: 'recoverable' });
        const location = response.headers.get('location');
        if (!location) throw new CommsHubError(502, 'attachment_redirect_invalid', 'Attachment download returned a redirect without a destination.', { failureClass: 'recoverable' });
        current = await this.assertPublicAttachmentUrl(new URL(location, current));
        continue;
      }
      if (!response.ok) throw new CommsHubError(502, 'attachment_download_failed', `Attachment download returned ${response.status}.`, { retryable: response.status >= 500, failureClass: response.status >= 500 ? 'temporary' : 'recoverable' });
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > this.context.config.attachmentMaxBytes) throw new CommsHubError(413, 'attachment_too_large', 'Attachment exceeds the configured size limit.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.context.config.attachmentMaxBytes) throw new CommsHubError(413, 'attachment_too_large', 'Attachment exceeds the configured size limit.');
      return { buffer, contentType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
    }
    throw new CommsHubError(502, 'attachment_download_failed', 'Attachment download could not be completed.');
  }

  scannerReady() {
    return Boolean(this.context.malwareScanner && this.context.config?.attachmentScannerUrl && this.context.config?.attachmentScannerToken);
  }

  async promoteQuarantined({ attachmentId, filename, contentType, body, sha256, quarantineKey, provider = 'direct', metadata = {} }) {
    const scannedAt = new Date().toISOString();
    const scan = await this.context.malwareScanner.scan({ buffer: body, filename, contentType });
    if (!scan.clean) {
      await this.context.operationsRepository.recordAttachmentObject({ id: stableId('aob', attachmentId), attachmentId, bucketName: this.context.config.r2PrivateBucketName, objectKey: quarantineKey, sha256, sizeBytes: body.length, contentType, scanStatus: 'infected', scanProvider: scan.provider, scanReference: scan.reference, scannedAt, storedAt: scannedAt, metadata: { ...metadata, quarantine: true, findings: scan.findings } });
      await this.context.d1.query(`UPDATE comms_hub_attachments SET status = 'quarantined' WHERE id = ?`, [attachmentId]);
      throw new CommsHubError(422, 'attachment_infected', 'Attachment failed malware scanning.', { failureClass: 'permanent' });
    }

    const cleanKey = `attachments/${scannedAt.slice(0, 10)}/${attachmentId}/${sha256.slice(0, 16)}-${filename}`;
    const stored = await this.context.privateR2.putBuffer(cleanKey, body, contentType, { sha256, attachment_id: attachmentId, scan_status: 'clean' });
    if (quarantineKey !== cleanKey) await this.context.privateR2.delete(quarantineKey).catch(() => {});
    const record = await this.context.operationsRepository.recordAttachmentObject({ id: stableId('aob', attachmentId), attachmentId, bucketName: stored.bucket, objectKey: stored.key, sha256, sizeBytes: stored.size, contentType, scanStatus: 'clean', scanProvider: scan.provider, scanReference: scan.reference, scannedAt, storedAt: scannedAt, metadata: { ...metadata, quarantine: false } });
    await this.context.d1.query(`UPDATE comms_hub_attachments SET status = 'stored' WHERE id = ?`, [attachmentId]);
    await this.context.operationsRepository.indexSearchDocument({ id: stableId('srch', 'attachment', attachmentId), objectType: 'attachment', objectId: attachmentId, conversationId: metadata.conversationId || null, contactId: metadata.contactId || null, channel: metadata.channel || null, searchableText: `${filename} ${contentType} ${provider}`, metadata: { sha256, sizeBytes: body.length }, updatedAt: scannedAt });
    return record;
  }

  async ingest({ attachmentId, filename, contentType, buffer, provider = 'direct', metadata = {} }) {
    this.assertReady();
    const storedFilename = safeFilename(filename);
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (!body.length) throw new CommsHubError(400, 'attachment_empty', 'Attachment is empty.');
    if (body.length > this.context.config.attachmentMaxBytes) throw new CommsHubError(413, 'attachment_too_large', 'Attachment exceeds the configured size limit.');
    const sha256 = sha256Hex(body);
    const storedAt = new Date().toISOString();
    const quarantineKey = `quarantine/attachments/${storedAt.slice(0, 10)}/${attachmentId}/${sha256.slice(0, 16)}-${storedFilename}`;

    // Always land untrusted uploads in the private quarantine prefix first. They are not
    // retrievable through get() until a scanner marks them clean and promotion succeeds.
    const quarantined = await this.context.privateR2.putBuffer(quarantineKey, body, contentType, { sha256, attachment_id: attachmentId, scan_status: 'pending' });
    await this.context.operationsRepository.recordAttachmentObject({ id: stableId('aob', attachmentId), attachmentId, bucketName: quarantined.bucket, objectKey: quarantined.key, sha256, sizeBytes: quarantined.size, contentType, scanStatus: 'pending', scanProvider: null, scanReference: null, scannedAt: null, storedAt, metadata: { ...metadata, quarantine: true } });
    await this.context.d1.query(`UPDATE comms_hub_attachments SET status = 'quarantined' WHERE id = ?`, [attachmentId]);

    if (!this.scannerReady()) return { ...quarantined, object_key: quarantined.key, scan_status: 'pending', quarantined: true };
    return this.promoteQuarantined({ attachmentId, filename: storedFilename, contentType, body, sha256, quarantineKey, provider, metadata });
  }

  async scanQuarantined(attachmentId) {
    this.assertReady();
    if (!this.scannerReady()) throw new CommsHubError(503, 'attachment_scanner_unconfigured', 'Attachment malware scanning is not configured.', { retryable: true, failureClass: 'temporary' });
    const record = await this.context.operationsRepository.getAttachmentObject(attachmentId);
    if (!record || record.deleted_at) throw new CommsHubError(404, 'attachment_unavailable', 'Attachment is unavailable.');
    if (record.scan_status === 'clean') return record;
    const body = await this.context.privateR2.getBuffer(record.object_key);
    if (sha256Hex(body) !== record.sha256) throw new CommsHubError(409, 'attachment_checksum_mismatch', 'Attachment integrity validation failed.');
    return this.promoteQuarantined({ attachmentId, filename: safeFilename(record.filename), contentType: record.content_type || 'application/octet-stream', body, sha256: record.sha256, quarantineKey: record.object_key, provider: record.provider || 'remote', metadata: {} });
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
