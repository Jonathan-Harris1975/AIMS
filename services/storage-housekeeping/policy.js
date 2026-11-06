export const POLICY_VERSION = 1;
export const ARCHIVE_BUCKET = "hive";
export const KDP_DATABASE_ID = "5f42a55b-c2bc-42a0-8337-1318e2c48ae7";
export const REQUIRED_DATABASES = Object.freeze([
  "aims-autonomous-recovery", "aims-ui-autonomous-recovery", "hive-autonomous-recovery", "hive-ui-autonomous-recovery",
  "irs-autonomous-recovery", "mast-autonomous-recovery", "rams-autonomous-recovery", "jonathan-harris-website-autonomous-recovery",
  "hive-operational-d1", "database-hive", "database-comms-hub", "COMMS_HUB_RESTORE_DATABASE",
]);
export const SCOPE = Object.freeze({
  metasystem: [""], "comms-hub": [""], "comms-hub-private": [""],
  hive: [""], "hive-repositories": [""], kdp: ["research/", "metadata/", "audit/"],
});
export const DAY = 86400000;
export const LIMITS = Object.freeze({ objects: 20000, changes: 100, rows: 25, objectBytes: 4 * 1024 * 1024, runtimeMs: 10 * 60 * 1000 });

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function assertObjectScope(bucket, key) {
  if (!SCOPE[bucket]?.some((prefix) => key.startsWith(prefix)) || key.includes("\0")) throw new Error("Object outside housekeeping scope");
}

export function excludedDatabase(database) {
  return String(database.uuid).toLowerCase() === KDP_DATABASE_ID || String(database.name).trim().toLowerCase() === "kdp";
}

export function ruleFor(bucket, key) {
  assertObjectScope(bucket, key);
  // Publication receipts and intent/history/control records are permanent replay
  // barriers. Live state, metadata, indexes and unresolved reviews have no TTL.
  if (/(^|\/)(latest(?:\.[^/]*)?|current(?:\.[^/]*)?|state|history|control)(\/|\.|$)/i.test(key)) return null;
  if (bucket === "metasystem") {
    if (/^reports\/openrouter-daily\/\d{4}-\d{2}-\d{2}\.json$/.test(key)) return { group: "spend", days: 365, terminal: "report" };
    if (/^evaluations\/newsletter-council-shadow\/\d{4}-\d{2}-\d{2}\/[a-f0-9]+\/[a-f0-9]+\.json$/.test(key)) {
      return { group: `shadow:${key.split("/")[3]}`, days: 180, terminal: "report" };
    }
  }
  if (bucket === "hive-repositories") {
    const weekly = key.match(/^reports\/weekly\/\d{4}-W\d{2}(-[^/]+)?\.(json|html)$/);
    if (weekly) return { group: `weekly:${weekly[1] || "overview"}:${weekly[2]}`, days: 730, terminal: "report" };
    const evidence = key.match(/^ci-reports\/([^/]+)\/\d{4}\/\d{2}\/.+\/lifecycle\/.+\/evidence\.json$/);
    if (evidence) return { group: `ci:${evidence[1]}`, days: 180, terminal: "green_evidence" };
  }
  if (bucket === "kdp") {
    if (/^audit\/reports\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9-]+\.json$/.test(key)) return { group: "audit", days: 365, terminal: "audit" };
    if (/^research\/weekly\/\d{4}-\d{2}-\d{2}\.json$/.test(key)) return { group: "research", days: 365, terminal: "research" };
    if (/^research\/readiness\/\d{4}-\d{2}-\d{2}\.json$/.test(key)) return { group: "readiness", days: 180, terminal: "report" };
  }
  return null;
}

export function terminalObject(rule, body) {
  if (rule.terminal === "report") return true;
  if (rule.terminal === "research") return body?.completed === true && (!body.pending || body.pending.length === 0);
  if (rule.terminal === "audit") return body?.ok === true && body?.complete === true && Boolean(body.completedAt);
  return body?.final_state === "GREEN" && body?.human_hold !== true && body?.ci_gate === "pass"
    && /^[a-f0-9]{40}$/.test(body?.head_sha || "")
    && body?.deployment_status === "pass" && body?.deployment_verified === true && body?.deployed_sha === body?.head_sha
    && ["socket_status", "codeql_status", "gitleaks_status", "trivy_status"].every((field) => body?.[field] === "pass");
}

export function selectObjects(bucket, objects, now, protectedKeys = new Set()) {
  const groups = new Map();
  for (const object of objects) {
    const rule = ruleFor(bucket, object.key);
    if (!rule) continue;
    const group = groups.get(rule.group) || [];
    group.push({ ...object, rule });
    groups.set(rule.group, group);
  }
  const selected = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified) || a.key.localeCompare(b.key));
    // Keep recent representatives even if the service has stopped producing reports.
    for (const object of group.slice(3)) {
      if (!protectedKeys.has(object.key) && Number.isFinite(Date.parse(object.lastModified))
        && Date.parse(object.lastModified) < now - object.rule.days * DAY) selected.push(object);
    }
  }
  return selected.sort((a, b) => a.key.localeCompare(b.key));
}

export function pointerKeys(value, bucket, found = new Set()) {
  if (typeof value === "string") {
    const key = value.startsWith(`r2://${bucket}/`) ? value.slice(`r2://${bucket}/`.length) : value;
    if (SCOPE[bucket]?.some((prefix) => key.startsWith(prefix)) && key.includes("/")) found.add(key);
  } else if (Array.isArray(value)) value.forEach((item) => pointerKeys(item, bucket, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => pointerKeys(item, bucket, found));
  return found;
}

export function weekKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const monday = new Date(`${local.year}-${local.month}-${local.day}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
