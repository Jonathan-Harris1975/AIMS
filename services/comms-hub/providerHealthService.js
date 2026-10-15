import { aiConfig } from "../../ai-config.js";
import { stableId } from "./domain/ids.js";

const CURRENT_AI_ROUTE_MODELS = aiConfig.routeModels || {};

function classify(entry, config, nowMs) {
  const lastAt = entry.lastAt ? Date.parse(entry.lastAt) : 0;
  const stale = !lastAt || nowMs - lastAt > config.providerHealthStaleMs;
  const lastStatus = String(entry.lastStatus || "unknown").toLowerCase();
  if (lastStatus === "configured" || lastStatus === "disabled") return "unknown";
  if (lastStatus === "unconfigured") return "unavailable";
  // A stale observation cannot describe current provider health. Keeping it
  // degraded would make old failures pin the overall badge indefinitely.
  if (stale) return "unknown";
  if (/429|rate|throttl/.test(lastStatus)) return "rate_limited";
  if (entry.failures >= config.providerHealthFailureThreshold && entry.failureRate >= 0.8) return "unavailable";
  if (entry.failures > 0 && entry.failureRate >= 0.25) return "degraded";
  return "healthy";
}

function isCommsHubRoute(entry, routeModels = CURRENT_AI_ROUTE_MODELS) {
  const routeKey = String(entry?.routeKey || "");
  if (routeKey.startsWith("comms-hub:")) return true;
  if (!routeKey.startsWith("commsHub") || routeKey.startsWith("commsHubOutreach")) return false;
  const configuredProviders = routeModels[routeKey];
  return Array.isArray(configuredProviders)
    && configuredProviders.includes(String(entry?.provider || ""));
}

function readinessEntries(context) {
  const emailConfigured = Boolean(
    context.config.oneComEmailAddress
    && context.config.oneComEmailUsername
    && context.config.oneComEmailPassword
    && context.config.oneComImapHost
    && context.config.oneComSmtpHost
  );
  const emailReadinessStatus = context.config.emailEnabled ? (emailConfigured ? "configured" : "unconfigured") : "disabled";
  const entries = [
    { routeKey: "comms-hub:storage", provider: "cloudflare-d1", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: "configured", lastAt: null },
    { routeKey: "comms-hub:intake", provider: "jotform", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: "configured", lastAt: null },
    { routeKey: "comms-hub:email-imap", provider: "one.com-imap", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: emailReadinessStatus, lastAt: null },
    { routeKey: "comms-hub:email-smtp", provider: "one.com-smtp", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: emailReadinessStatus, lastAt: null },
  ];
  for (const [family, config] of Object.entries(context.config.zernioFamilies)) {
    entries.push({
      routeKey: `comms-hub:zernio-${family}`,
      provider: `zernio-${family}`,
      calls: 0,
      successes: 0,
      failures: 0,
      failureRate: 0,
      lastStatus: config.enabled ? "configured" : "disabled",
      lastAt: null,
    });
  }
  if (context.config.aiEnabled) {
    entries.push({ routeKey: "comms-hub:knowledge", provider: "cloudflare-ai-search", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: "configured", lastAt: null });
  }
  return entries;
}

export class CommsHubProviderHealthService {
  constructor({ context, snapshotProvider = null, routeModels = CURRENT_AI_ROUTE_MODELS }) {
    this.context = context;
    this.snapshotProvider = snapshotProvider;
    this.routeModels = routeModels;
  }

  async getSnapshot() {
    if (this.snapshotProvider) return this.snapshotProvider();
    const { getOperationalExcellenceSnapshot } = await import("../shared/utils/operationalExcellence.js");
    return getOperationalExcellenceSnapshot();
  }

  async capture() {
    const observedAt = new Date().toISOString();
    const nowMs = Date.parse(observedAt);
    const snapshot = await this.getSnapshot();
    const entriesByProviderRoute = new Map();
    for (const entry of readinessEntries(this.context)) {
      const key = `${String(entry.provider || "unknown")}::${String(entry.routeKey || "unknown")}`;
      entriesByProviderRoute.set(key, entry);
    }
    for (const entry of Object.values(snapshot.providers || {})) {
      if (!isCommsHubRoute(entry, this.routeModels)) continue;
      const key = `${String(entry.provider || "unknown")}::${String(entry.routeKey || "unknown")}`;
      entriesByProviderRoute.set(key, entry);
    }
    const providerEntries = [...entriesByProviderRoute.values()];
    const captured = [];
    for (const entry of providerEntries) {
      const provider = String(entry.provider || "unknown");
      const adapter = String(entry.routeKey || "unknown");
      const status = classify(entry, this.context.config, nowMs);
      const record = {
        id: stableId("phl", provider, adapter, observedAt),
        provider,
        adapter,
        status,
        successCount: Number(entry.successes || 0),
        failureCount: Number(entry.failures || 0),
        consecutiveFailures: entry.lastStatus === "success" || entry.lastStatus === "configured"
          ? 0
          : Number(entry.consecutiveFailures ?? entry.failures ?? 0),
        lastStatusCode: entry.lastStatus || null,
        lastSuccessAt: entry.successes ? entry.lastAt : null,
        lastFailureAt: entry.failures ? entry.lastAt : null,
        observedAt,
        evidence: {
          calls: Number(entry.calls || 0),
          failureRate: Number(entry.failureRate || 0),
          averageLatencyMs: Number(entry.averageLatencyMs || 0),
          maxLatencyMs: Number(entry.maxLatencyMs || 0),
          releaseId: snapshot.releaseId || null,
        },
      };
      captured.push(record);
    }
    if (captured.length) await this.context.aiRepository.recordProviderHealthBatch(captured);
    return captured;
  }

  async status() {
    const storedProviders = await this.context.aiRepository.listLatestProviderHealth();
    // Ignore legacy rows captured before snapshots were scoped to Comms Hub.
    const nowMs = Date.now();
    const providers = storedProviders
      .filter((item) => isCommsHubRoute({ routeKey: item.adapter, provider: item.provider }, this.routeModels))
      .map((item) => {
        let evidence = {};
        try {
          evidence = typeof item.evidence_json === "string" ? JSON.parse(item.evidence_json) : (item.evidence || {});
        } catch {
          evidence = {};
        }
        return {
          ...item,
          status: classify({
            lastAt: item.last_failure_at || item.last_success_at || item.lastFailureAt || item.lastSuccessAt,
            lastStatus: item.last_status_code ?? item.lastStatusCode,
            failures: item.failure_count ?? item.failureCount,
            failureRate: Number(evidence.failureRate || 0),
          }, this.context.config, nowMs),
        };
      });
    const rank = { unavailable: 4, rate_limited: 3, degraded: 2, unknown: 1, healthy: 0 };
    const overall = providers.reduce((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, "healthy");
    return { overall: providers.length ? overall : "unknown", providers };
  }
}

export default CommsHubProviderHealthService;
