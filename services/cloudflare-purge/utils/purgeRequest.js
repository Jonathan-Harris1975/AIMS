const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on", "all", "everything", "purge_everything"]);
const PURGE_EVERYTHING_MODES = new Set(["all", "everything", "purge_all", "purge-everything", "purge_everything", "purgeeverything"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normaliseString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isEmptyPlainObject(value) {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function truthy(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return TRUE_VALUES.has(normaliseString(value).toLowerCase());
}

function asArray(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return trimmed
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [value];
}

function cleanStringArray(value) {
  const values = asArray(value);
  if (!values) return undefined;

  const cleaned = values
    .map((item) => normaliseString(item))
    .filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}

function cleanFileEntry(value) {
  if (isPlainObject(value)) {
    const url = normaliseString(value.url || value.href || value.file);
    if (!url) return null;

    const output = { url };
    if (isPlainObject(value.headers)) {
      const headers = Object.fromEntries(
        Object.entries(value.headers)
          .map(([key, headerValue]) => [normaliseString(key), normaliseString(headerValue)])
          .filter(([key, headerValue]) => key && headerValue)
      );
      if (Object.keys(headers).length) output.headers = headers;
    }
    return output;
  }

  const url = normaliseString(value);
  return url ? url : null;
}

function cleanFiles(value) {
  const values = asArray(value);
  if (!values) return undefined;

  const cleaned = values
    .map(cleanFileEntry)
    .filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}

function normalisePrefix(value) {
  const raw = normaliseString(value).replace(/^\/+/, "");
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    return `${parsed.host}${parsed.pathname}${parsed.search}`.replace(/^\/+/, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
  }
}

function cleanPrefixes(value) {
  const values = asArray(value);
  if (!values) return undefined;

  const cleaned = values
    .map(normalisePrefix)
    .filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}

function firstObject(...values) {
  return values.find(isPlainObject) || {};
}

function collectCandidateBodies(body = {}) {
  if (!isPlainObject(body)) return [{}];

  return [
    body,
    firstObject(body.data),
    firstObject(body.payload),
    firstObject(body.body),
    firstObject(body.event?.data),
    firstObject(body.event?.payload),
  ].filter((value, index, list) => isPlainObject(value) && list.indexOf(value) === index);
}

function hasPurgeMode(value = {}) {
  if (!isPlainObject(value)) return false;
  return Boolean(
    value.purge_everything === true ||
    truthy(value.purgeEverything) ||
    truthy(value.purge_all) ||
    PURGE_EVERYTHING_MODES.has(normaliseString(value.mode).toLowerCase()) ||
    PURGE_EVERYTHING_MODES.has(normaliseString(value.type).toLowerCase()) ||
    value.files !== undefined ||
    value.urls !== undefined ||
    value.url !== undefined ||
    value.tags !== undefined ||
    value.hosts !== undefined ||
    value.hostnames !== undefined ||
    value.prefixes !== undefined
  );
}

function firstBodyWithPurgeMode(body = {}) {
  const candidates = collectCandidateBodies(body);
  return candidates.find(hasPurgeMode) || candidates[0] || {};
}

function addField(output, key, value) {
  if (value !== undefined) output[key] = value;
}

export function normaliseCloudflarePurgeRequestBody(body = {}, query = {}) {
  const source = firstBodyWithPurgeMode(body);
  const queryMode = normaliseString(query.mode || query.type || query.purge).toLowerCase();
  const output = {};

  const emptyWebhookCall = isEmptyPlainObject(source) && isEmptyPlainObject(query);
  const explicitPurgeEverything =
    source.purge_everything === true ||
    truthy(source.purgeEverything) ||
    truthy(source.purge_all) ||
    truthy(query.purge_everything) ||
    truthy(query.purgeEverything) ||
    truthy(query.purge_all) ||
    PURGE_EVERYTHING_MODES.has(normaliseString(source.mode).toLowerCase()) ||
    PURGE_EVERYTHING_MODES.has(normaliseString(source.type).toLowerCase()) ||
    PURGE_EVERYTHING_MODES.has(queryMode);

  if (emptyWebhookCall || explicitPurgeEverything) {
    output.purge_everything = true;
  }

  addField(output, "files", cleanFiles(source.files ?? source.urls ?? source.url ?? query.files ?? query.urls ?? query.url));
  addField(output, "tags", cleanStringArray(source.tags ?? query.tags));
  addField(output, "hosts", cleanStringArray(source.hosts ?? source.hostnames ?? query.hosts ?? query.hostnames));
  addField(output, "prefixes", cleanPrefixes(source.prefixes ?? query.prefixes));

  return output;
}

export default normaliseCloudflarePurgeRequestBody;
