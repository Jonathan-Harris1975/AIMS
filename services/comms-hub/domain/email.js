import { randomUUID } from "node:crypto";
import { CommsHubError } from "../errors.js";
import { sha256Hex } from "./ids.js";

function unfoldHeaders(value) {
  return String(value || "").replace(/\r?\n[ \t]+/g, " ");
}

function headerMap(rawHeaders) {
  const map = new Map();
  for (const line of unfoldHeaders(rawHeaders).split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function firstHeader(headers, name) {
  return headers.get(name.toLowerCase())?.[0] || "";
}

export function parseAddressList(value) {
  const output = [];
  const source = String(value || "");
  const pattern = /(?:(?:"([^"]+)"|([^,<]+))\s*)?<([^<>\s]+@[^<>\s]+)>|([^,\s<>]+@[^,\s<>]+)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const address = String(match[3] || match[4] || "").trim().toLowerCase();
    if (!address) continue;
    output.push({ address, name: String(match[1] || match[2] || "").trim() || null });
  }
  return output;
}

function decodeQuotedPrintable(input) {
  const source = String(input || "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "=" && /^[A-Fa-f0-9]{2}$/.test(source.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(source.charCodeAt(index));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBody(body, encoding) {
  const normalised = String(encoding || "").trim().toLowerCase();
  if (normalised === "base64") {
    try { return Buffer.from(String(body || "").replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return ""; }
  }
  if (normalised === "quoted-printable") return decodeQuotedPrintable(body);
  return String(body || "");
}

function headerParameter(value, name) {
  const pattern = new RegExp(`${name}=(?:"([^"]+)"|([^;\\s]+))`, "i");
  const match = String(value || "").match(pattern);
  return String(match?.[1] || match?.[2] || "").trim();
}

function parseMimePart(raw, depth = 0) {
  if (depth > 10) return { text: "", html: "", attachments: [] };
  const split = String(raw || "").search(/\r?\n\r?\n/);
  const rawHeaders = split >= 0 ? raw.slice(0, split) : "";
  const rawBody = split >= 0 ? raw.slice(split).replace(/^\r?\n\r?\n/, "") : raw;
  const headers = headerMap(rawHeaders);
  const contentType = firstHeader(headers, "content-type") || "text/plain";
  const encoding = firstHeader(headers, "content-transfer-encoding");
  const disposition = firstHeader(headers, "content-disposition");
  const boundary = headerParameter(contentType, "boundary");

  if (/^multipart\//i.test(contentType) && boundary) {
    const delimiter = `--${boundary}`;
    const sections = rawBody.split(delimiter).slice(1).map((part) => part.replace(/^\r?\n/, "").replace(/\r?\n--\r?\n?$/, "")).filter(Boolean);
    return sections.reduce((combined, section) => {
      const parsed = parseMimePart(section, depth + 1);
      if (!combined.text && parsed.text) combined.text = parsed.text;
      if (!combined.html && parsed.html) combined.html = parsed.html;
      combined.attachments.push(...parsed.attachments);
      return combined;
    }, { text: "", html: "", attachments: [] });
  }

  const filename = headerParameter(disposition, "filename") || headerParameter(contentType, "name");
  const decoded = decodeBody(rawBody, encoding);
  if (filename || /attachment/i.test(disposition)) {
    const buffer = encoding.toLowerCase() === "base64"
      ? Buffer.from(String(rawBody || "").replace(/\s+/g, ""), "base64")
      : Buffer.from(decoded, "utf8");
    return {
      text: "",
      html: "",
      attachments: [{
        filename: filename || "attachment.bin",
        contentType: contentType.split(";")[0].trim().toLowerCase(),
        buffer,
        size: buffer.length,
        sha256: sha256Hex(buffer),
      }],
    };
  }
  if (/^text\/html/i.test(contentType)) return { text: "", html: decoded, attachments: [] };
  if (/^text\/plain/i.test(contentType)) return { text: decoded, html: "", attachments: [] };
  return { text: "", html: "", attachments: [] };
}

export function parseRawEmail(raw) {
  const source = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  const split = source.search(/\r?\n\r?\n/);
  const rawHeaders = split >= 0 ? source.slice(0, split) : source;
  const headers = headerMap(rawHeaders);
  const mime = parseMimePart(source);
  const from = parseAddressList(firstHeader(headers, "from"))[0] || null;
  const to = parseAddressList(firstHeader(headers, "to"));
  const cc = parseAddressList(firstHeader(headers, "cc"));
  const messageId = firstHeader(headers, "message-id").replace(/^<|>$/g, "");
  const inReplyTo = firstHeader(headers, "in-reply-to").replace(/^<|>$/g, "");
  const references = firstHeader(headers, "references").split(/\s+/).map((item) => item.replace(/^<|>$/g, "")).filter(Boolean);
  const dateValue = Date.parse(firstHeader(headers, "date"));
  return Object.freeze({
    messageId: messageId || `${sha256Hex(source).slice(0, 32)}@generated.local`,
    inReplyTo: inReplyTo || null,
    references,
    subject: firstHeader(headers, "subject") || "(no subject)",
    from,
    to,
    cc,
    replyTo: parseAddressList(firstHeader(headers, "reply-to"))[0] || null,
    receivedAt: Number.isFinite(dateValue) ? new Date(dateValue).toISOString() : new Date().toISOString(),
    text: String(mime.text || "").trim(),
    html: String(mime.html || "").trim() || null,
    attachments: mime.attachments,
    headers: Object.fromEntries([...headers.entries()].map(([key, values]) => [key, values])),
    rawSha256: sha256Hex(source),
  });
}

function foldHeader(name, value) {
  const clean = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return `${name}: ${clean}`;
}

function normaliseCrlf(value) {
  return String(value || "").replace(/\r?\n/g, "\r\n");
}

function base64Lines(buffer) {
  return Buffer.from(buffer).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}

export function buildRawEmail({
  from, to, cc = [], subject, bodyText, bodyHtml = null, messageId = "",
  inReplyTo = "", references = [], attachments = [], date = new Date(),
}) {
  if (!from || !Array.isArray(to) || !to.length) {
    throw new CommsHubError(400, "email_addresses_invalid", "Email sender and at least one recipient are required.");
  }
  const generatedMessageId = messageId || `${randomUUID()}@aims.local`;
  const boundary = `aims_${sha256Hex(`${generatedMessageId}:${Date.now()}`).slice(0, 32)}`;
  const alternativeBoundary = `${boundary}_alt`;
  const headers = [
    foldHeader("Date", date.toUTCString()),
    foldHeader("From", from),
    foldHeader("To", to.join(", ")),
    ...(cc.length ? [foldHeader("Cc", cc.join(", "))] : []),
    foldHeader("Subject", subject || ""),
    foldHeader("Message-ID", `<${generatedMessageId.replace(/^<|>$/g, "")}>`),
    ...(inReplyTo ? [foldHeader("In-Reply-To", `<${inReplyTo.replace(/^<|>$/g, "")}>`)] : []),
    ...(references.length ? [foldHeader("References", references.map((value) => `<${String(value).replace(/^<|>$/g, "")}>`).join(" "))] : []),
    "MIME-Version: 1.0",
  ];

  const hasAttachments = attachments.length > 0;
  const hasHtml = Boolean(bodyHtml);
  if (hasAttachments) headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  else if (hasHtml) headers.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`);
  else headers.push("Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");

  const parts = [];
  const addBody = (containerBoundary) => {
    if (hasHtml) {
      parts.push(`--${containerBoundary}`);
      parts.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, "");
      parts.push(`--${alternativeBoundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", normaliseCrlf(bodyText));
      parts.push(`--${alternativeBoundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", normaliseCrlf(bodyHtml));
      parts.push(`--${alternativeBoundary}--`);
    } else {
      parts.push(`--${containerBoundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", normaliseCrlf(bodyText));
    }
  };

  if (hasAttachments) {
    addBody(boundary);
    for (const attachment of attachments) {
      const filename = String(attachment.filename || "attachment.bin").replace(/[\r\n"]/g, "_");
      parts.push(
        `--${boundary}`,
        `Content-Type: ${attachment.contentType || "application/octet-stream"}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${filename}"`,
        "",
        base64Lines(attachment.buffer)
      );
    }
    parts.push(`--${boundary}--`);
  } else if (hasHtml) {
    parts.push(`--${alternativeBoundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", normaliseCrlf(bodyText));
    parts.push(`--${alternativeBoundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", normaliseCrlf(bodyHtml));
    parts.push(`--${alternativeBoundary}--`);
  } else {
    parts.push(normaliseCrlf(bodyText));
  }

  return Object.freeze({
    messageId: generatedMessageId,
    raw: `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n`,
  });
}

export function emailThreadKey(message) {
  const references = [...(message.references || []), message.inReplyTo].filter(Boolean);
  if (references.length) return references[0];
  const subject = String(message.subject || "").replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim().toLowerCase();
  return `${message.from?.address || "unknown"}:${sha256Hex(subject).slice(0, 24)}`;
}
