function trim(value) {
  return String(value || "").trim();
}

function slug(value) {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "service";
}

export function normaliseStatusBasePath(value, service) {
  const configured = trim(value).replace(/\/+$/, "");
  const base = configured || `/${slug(service)}/jobs`;
  return base.startsWith("/") ? base : `/${base}`;
}

export function statusUrlFor(req, service, lane, sessionId, statusBasePath = "") {
  const path = `${normaliseStatusBasePath(statusBasePath, service)}/${slug(lane)}/${encodeURIComponent(sessionId)}`;
  if (!req?.protocol || !req?.get) return path;
  return `${req.protocol}://${req.get("host")}${path}`;
}

export default { normaliseStatusBasePath, statusUrlFor };
