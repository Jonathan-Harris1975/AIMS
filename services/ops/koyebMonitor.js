import { flushStateWrites, readJsonStateFresh, writeJsonState } from "../shared/utils/stateFile.js";
import { sendOperationalEvent } from "../shared/utils/operationalExcellence.js";
import { info, warn } from "../../logger.js";

const STATE_FILE = "koyeb-monitor-state.json";
const API_BASE = "https://app.koyeb.com/v1";
const FAILURE_STATUSES = new Set(["degraded", "unhealthy", "error", "failed"]);
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function normaliseStatus(value) {
  if (value && typeof value === "object") {
    value = value.status || value.state || value.name;
  }
  return String(value || "unknown").trim().toLowerCase();
}

function serviceStatus(service) {
  return normaliseStatus(service?.status);
}

function serviceRevision(service, isAimsService) {
  const candidates = [
    service?.deployment?.git?.sha,
    service?.deployment?.git?.commit_sha,
    service?.active_deployment?.git?.sha,
    service?.active_deployment?.git?.commit_sha,
    service?.metadata?.git?.sha,
  ];
  const exact = candidates.find((value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value));
  if (exact) return exact.toLowerCase();
  const runtimeSha = isAimsService ? String(process.env.KOYEB_GIT_SHA || "").trim().toLowerCase() : "";
  return /^[0-9a-f]{40}$/.test(runtimeSha) ? runtimeSha : null;
}

function selectedAimsService(service, configured) {
  const target = String(configured || "").trim().toLowerCase();
  if (!target) return false;
  return [service?.id, service?.name, service?.slug].some((value) => String(value || "").trim().toLowerCase() === target);
}

function identifyAimsService(services, configured, runtimeSha) {
  if (String(configured || "").trim()) {
    const matches = services.filter((service) => selectedAimsService(service, configured));
    return matches.length === 1 ? String(matches[0].id || matches[0].name) : null;
  }
  const sha = String(runtimeSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  const matches = services.filter((service) => serviceRevision(service, false) === sha);
  return matches.length === 1 ? String(matches[0].id || matches[0].name) : null;
}

async function requestServices({ token, fetchImpl = fetch, apiBase = API_BASE }) {
  const services = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const response = await fetchImpl(`${apiBase}/services?limit=${PAGE_SIZE}&offset=${offset}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Koyeb services API returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.services)) throw new Error("Koyeb services API returned an invalid service list");
    services.push(...payload.services);
    if (payload.has_next !== true || payload.services.length === 0) break;
  }
  return services;
}

function eventId(service, status, revision) {
  return `koyeb:${service.id || service.name || "unknown"}:${status}:${revision || "revision-unavailable"}`.slice(0, 160);
}

export async function checkKoyebServices({
  token = process.env.KOYEB_TOKEN,
  configuredService = process.env.KOYEB_SERVICE,
  fetchImpl = fetch,
  apiBase = API_BASE,
  runtimeSha = process.env.KOYEB_GIT_SHA,
  readState = readJsonStateFresh,
  writeState = writeJsonState,
  flushWrites = flushStateWrites,
  sendEvent = sendOperationalEvent,
  now = () => new Date(),
} = {}) {
  if (!String(token || "").trim()) return { ok: false, skipped: true, reason: "koyeb_token_missing" };
  const services = await requestServices({ token: String(token).trim(), fetchImpl, apiBase });
  const state = await readState(STATE_FILE, { version: 1, services: {} });
  const previous = state?.services && typeof state.services === "object" ? state.services : {};
  const next = { version: 1, checkedAt: now().toISOString(), services: {} };
  const events = [];
  const aimsServiceId = identifyAimsService(services, configuredService, runtimeSha);
  const aimsServiceSeen = Boolean(aimsServiceId);

  for (const service of services) {
    const id = String(service?.id || service?.name || "").trim();
    if (!id) continue;
    const status = serviceStatus(service);
    const isAims = id === aimsServiceId;
    const revision = serviceRevision(service, isAims);
    const current = { name: String(service.name || id).slice(0, 120), status, revision, checkedAt: next.checkedAt };
    next.services[id] = current;
    const wasFailure = FAILURE_STATUSES.has(previous[id]?.status);
    const isFailure = FAILURE_STATUSES.has(status);
    if (isFailure && (!wasFailure || previous[id]?.status !== status || previous[id]?.revision !== revision)) {
      const result = await sendEvent({
        event_id: eventId(service, status, revision),
        source: "koyeb",
        service: isAims ? "Jonathan-Harris1975/AIMS" : "Koyeb",
        environment: "production",
        severity: "critical",
        event_type: "koyeb_service_unhealthy",
        status: "failure",
        release_id: revision,
        title: `Koyeb service ${current.name} is ${status}`,
        summary: `The read-only AIMS Koyeb monitor detected service status ${status}.`,
        details: {
          service_id: id,
          service_name: current.name,
          service_status: status,
          active_deployment_id: String(service.active_deployment_id || "").slice(0, 120) || null,
          repository_mapping: isAims ? "configured_aims_service" : "unmapped_service_in_account_inventory",
        },
      });
      events.push({ service_id: id, status, delivered: Boolean(result?.ok), revision_available: Boolean(revision) });
      if (!result?.ok) next.services[id] = previous[id] || { ...current, status: "unknown" };
    }
    if (!isFailure && wasFailure) {
      const result = await sendEvent({
        event_id: `koyeb:${id}:recovered:${revision || "revision-unavailable"}`.slice(0, 160),
        source: "koyeb",
        service: isAims ? "Jonathan-Harris1975/AIMS" : "Koyeb",
        environment: "production",
        severity: "info",
        event_type: "koyeb_service_recovered",
        status: "recovered",
        release_id: revision,
        title: `Koyeb service ${current.name} recovered`,
        summary: "The Koyeb service has returned to a non-failure state.",
        details: { service_id: id, service_name: current.name, service_status: status },
      });
      if (!result?.ok) next.services[id] = previous[id];
    }
  }

  if (configuredService && !aimsServiceSeen) {
    const revision = /^[0-9a-f]{40}$/.test(String(runtimeSha || "").trim().toLowerCase())
      ? String(runtimeSha).trim().toLowerCase()
      : null;
    const result = await sendEvent({
      event_id: `koyeb:aims-service-not-found:${revision || "revision-unavailable"}`,
      source: "koyeb",
      service: "Jonathan-Harris1975/AIMS",
      environment: "production",
      severity: "critical",
      event_type: "koyeb_service_inventory_mismatch",
      status: "failure",
      release_id: revision,
      title: "Configured AIMS Koyeb service is missing from the service inventory",
      summary: "The Koyeb API did not return the service selected by KOYEB_SERVICE.",
      details: { configured_service_present: true, service_count: services.length },
    });
    events.push({ service_id: String(configuredService).slice(0, 120), status: "inventory_mismatch", delivered: Boolean(result?.ok), revision_available: Boolean(revision) });
  }

  const saved = await writeState(STATE_FILE, next);
  if (!saved) throw new Error("Koyeb monitor state could not be persisted");
  await flushWrites({ throwOnError: true });
  return { ok: true, service_count: Object.keys(next.services).length, events };
}

let timer;
let running = false;

export function startKoyebMonitor() {
  if (timer || !String(process.env.KOYEB_TOKEN || "").trim()) return;
  const interval = Math.max(30000, Number(process.env.KOYEB_MONITOR_INTERVAL_MS || 60000));
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const result = await checkKoyebServices();
      if (result.ok) info("koyeb.monitor.checked", { services: result.service_count, events: result.events.length });
    } catch (error) {
      warn("koyeb.monitor.failed", { errorName: error?.name || "Error", message: String(error?.message || error).slice(0, 180) });
    } finally {
      running = false;
    }
  };
  void poll();
  timer = setInterval(() => void poll(), interval);
  timer.unref?.();
  info("koyeb.monitor.started", { interval_ms: interval });
}

export function stopKoyebMonitor() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
