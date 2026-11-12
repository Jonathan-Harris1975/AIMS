// RFC 3464 machine-readable reports only. Human prose is never delivery evidence.
function fields(source) {
  const result = {};
  for (const line of source.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const split = line.indexOf(':');
    if (split > 0) result[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
  }
  return result;
}

function entity(source) {
  const split = source.search(/\r?\n\r?\n/);
  if (split < 0) return { headers: fields(source), body: '' };
  return { headers: fields(source.slice(0, split)), body: source.slice(split).replace(/^\r?\n\r?\n/, '') };
}

function parameter(type, key) {
  return type.match(new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, 'i'))?.slice(1).find(Boolean) || '';
}

function decode(body, encoding = '') {
  if (encoding.toLowerCase() === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (encoding.toLowerCase() === 'quoted-printable') {
    return body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
}

export function normaliseMessageId(value = '') {
  return String(value).trim().replace(/^<|>$/g, '');
}

export function parseDeliveryReport(raw) {
  const source = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (source.length > 2_000_000) return null;
  const outer = entity(source);
  const type = outer.headers['content-type'] || '';
  if (!/^multipart\/report\b/i.test(type) || parameter(type, 'report-type').toLowerCase() !== 'delivery-status') return null;
  const boundary = parameter(type, 'boundary');
  if (!boundary || boundary.length > 200) return null;
  // Split at MIME boundary lines, never at an arbitrary occurrence in prose.
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = outer.body.split(new RegExp(`(?:^|\\r?\\n)--${escaped}(?:--)?[ \\t]*(?:\\r?\\n|$)`)).slice(1, -1).map(entity);
  const statusPart = parts.find(p => /^message\/delivery-status\b/i.test(p.headers['content-type'] || ''));
  if (!statusPart) return null;
  const blocks = decode(statusPart.body, statusPart.headers['content-transfer-encoding']).trim().split(/\r?\n\s*\r?\n/).map(fields);
  const originalPart = parts.find(p => /^(?:message\/rfc822|text\/rfc822-headers)\b/i.test(p.headers['content-type'] || ''));
  const returned = originalPart ? fields(decode(originalPart.body, originalPart.headers['content-transfer-encoding']).split(/\r?\n\r?\n/)[0]) : {};
  const originalMessageId = normaliseMessageId(blocks[0]?.['original-message-id'] || returned['message-id']);
  if (!originalMessageId || originalMessageId.length > 998) return null;
  const recipients = blocks.slice(1).flatMap(block => {
    const action = (block.action || '').toLowerCase();
    const status = block.status || '';
    const expected = { failed: '5', delayed: '4', delivered: '2', relayed: '2', expanded: '2' }[action];
    const recipient = (block['original-recipient'] || block['final-recipient'] || '').match(/^rfc822\s*;\s*([^\s<>]+@[^\s<>]+)$/i)?.[1].toLowerCase();
    if (!recipient || !expected || !new RegExp(`^${expected}\\.\\d{1,3}\\.\\d{1,3}$`).test(status)) return [];
    return [{ recipient, action, status, diagnostic: String(block['diagnostic-code'] || '').slice(0, 1000),
      remoteMta: String(block['remote-mta'] || '').slice(0, 255) }];
  });
  if (!recipients.length) return null;
  return { originalMessageId, reportingMta: String(blocks[0]?.['reporting-mta'] || '').slice(0, 255), recipients };
}
