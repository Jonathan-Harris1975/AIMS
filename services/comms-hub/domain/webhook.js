import { COMMS_HUB_FORM_ROUTES } from "../config.js";
import { CommsHubError } from "../errors.js";

const DIGITS_ONLY = /^\d+$/;
const SUPPORTED_CONTENT_TYPES = new Set([
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
]);

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function digits(value) {
  const candidate = text(value);
  return DIGITS_ONLY.test(candidate) ? candidate : "";
}

function parseRawRequest(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const raw = text(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("rawRequest must contain an object");
    }
    return parsed;
  } catch (cause) {
    throw new CommsHubError(400, "jotform_raw_request_invalid", "Jotform rawRequest is not valid JSON.", {
      cause,
      publicMessage: "Invalid Jotform webhook payload.",
    });
  }
}

function contentTypeBase(req) {
  return text(req.get?.("content-type") || req.headers?.["content-type"])
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function contentLength(req) {
  const value = Number(req.get?.("content-length") || req.headers?.["content-length"] || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function readStream(req, maxBytes) {
  const declared = contentLength(req);
  if (declared > maxBytes) {
    throw new CommsHubError(413, "jotform_webhook_too_large", "Jotform webhook exceeds the configured size limit.", {
      publicMessage: "Webhook payload too large.",
    });
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new CommsHubError(413, "jotform_webhook_too_large", "Jotform webhook exceeds the configured size limit.", {
        publicMessage: "Webhook payload too large.",
      });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseMultipartBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = text(match?.[1] || match?.[2]);
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw new CommsHubError(400, "jotform_multipart_boundary_invalid", "Multipart webhook boundary is missing or invalid.", {
      publicMessage: "Invalid Jotform webhook payload.",
    });
  }
  return boundary;
}

export function parseMultipartFields(buffer, contentType) {
  const boundary = parseMultipartBoundary(contentType);
  const delimiter = `--${boundary}`;
  const body = buffer.toString("latin1");
  const fields = {};

  for (const part of body.split(delimiter)) {
    if (!part || part === "--\r\n" || part === "--" || part === "\r\n") continue;
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n--$/, "").replace(/\r\n$/, "");
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerText = trimmed.slice(0, headerEnd);
    const valueBytes = Buffer.from(trimmed.slice(headerEnd + 4), "latin1");
    const disposition = headerText
      .split("\r\n")
      .find((line) => /^content-disposition:/i.test(line));
    const nameMatch = disposition?.match(/\bname="([^"]+)"/i);
    const filenameMatch = disposition?.match(/\bfilename="([^"]*)"/i);
    if (!nameMatch || filenameMatch) continue;
    const name = nameMatch[1];
    if (!["formID", "formId", "form_id", "submissionID", "submissionId", "submission_id", "rawRequest", "raw_request"].includes(name)) {
      continue;
    }
    fields[name] = valueBytes.toString("utf8").trim();
  }

  return fields;
}

function normaliseBodyObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CommsHubError(400, "jotform_webhook_invalid", "Jotform webhook payload must be an object.", {
      publicMessage: "Invalid Jotform webhook payload.",
    });
  }
  return body;
}

export async function readJotformWebhookEnvelope(req, maxBytes) {
  const baseType = contentTypeBase(req);
  if (!SUPPORTED_CONTENT_TYPES.has(baseType)) {
    throw new CommsHubError(415, "jotform_content_type_unsupported", `Unsupported Jotform webhook content type: ${baseType || "missing"}.`, {
      publicMessage: "Unsupported webhook content type.",
    });
  }

  if (baseType === "multipart/form-data") {
    const raw = await readStream(req, maxBytes);
    return parseMultipartFields(raw, req.get?.("content-type") || req.headers?.["content-type"]);
  }

  const declared = contentLength(req);
  const parsedBytes = Number(req.aimsParsedBodyBytes || 0);
  if (declared > maxBytes || parsedBytes > maxBytes) {
    throw new CommsHubError(413, "jotform_webhook_too_large", "Jotform webhook exceeds the configured size limit.", {
      publicMessage: "Webhook payload too large.",
    });
  }

  if (baseType === "application/json") {
    return normaliseBodyObject(req.body);
  }

  return normaliseBodyObject(req.body);
}

export function resolveJotformWebhook(envelope) {
  const body = normaliseBodyObject(envelope);
  const rawRequest = parseRawRequest(body.rawRequest ?? body.raw_request);
  const formId = [body.formID, body.formId, body.form_id, rawRequest.formID, rawRequest.formId, rawRequest.form_id]
    .map(digits)
    .find(Boolean) || "";
  const submissionId = [
    body.submissionID,
    body.submissionId,
    body.submission_id,
    rawRequest.submissionID,
    rawRequest.submissionId,
    rawRequest.submission_id,
  ].map(digits).find(Boolean) || "";

  if (!formId || !submissionId) {
    throw new CommsHubError(400, "jotform_identifiers_missing", "Jotform formID and submissionID are required.", {
      publicMessage: "Webhook identifiers are missing.",
    });
  }

  const route = COMMS_HUB_FORM_ROUTES[formId];
  if (!route) {
    throw new CommsHubError(403, "jotform_form_not_allowed", `Jotform ${formId} is not registered for Comms Hub intake.`, {
      publicMessage: "This form is not registered for Comms Hub.",
    });
  }

  return Object.freeze({ formId, submissionId, route });
}
