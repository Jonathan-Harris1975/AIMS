import { stableId } from "./domain/ids.js";

function classify(entry, config, nowMs) {
  const lastAt = entry.lastAt ? Date.parse(entry.lastAt) : 0;
  const stale = !lastAt || nowMs - lastAt > config.providerHealthStaleMs;
  const lastStatus = String(entry.lastStatus || "unknown").toLowerCase();
  if (lastStatus === "configured" || lastStatus === "disabled") return "unknown";
  if (/429|rate|throttl/.test(lastStatus)) return "rate_limited";
  if (!stale && entry.failures >= config.providerHealthFailureThreshold && entry.failureRate >= 0.8) return "unavailable";
  if (stale) return entry.calls ? "degraded" : "unknown";
  if (entry.failures > 0 && entry.failureRate >= 0.25) return "degraded";
  return "healthy";
}

function readinessEntries(context) {
  const entries = [
    { routeKey: "comms-hub:storage", provider: "cloudflare-d1", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: "configured", lastAt: null },
    { routeKey: "comms-hub:intake", provider: "jotform", calls: 0, successes: 0, failures: 0, failureRate: 0, lastStatus: "configured", lastAt: null },
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
  constructor({ context, snapshotProvider = null }) {
    this.context = context;
    this.snapshotProvider = snapshotProvider;
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
      await this.context.aiRepository.recordProviderHealth(record);
      captured.push(record);
    }
    return captured;
  }

  async status() {
    const providers = await this.context.aiRepository.listLatestProviderHealth();
    const rank = { unavailable: 4, rate_limited: 3, degraded: 2, unknown: 1, healthy: 0 };
    const overall = providers.reduce((worst, item) => rank[item.status] > rank[worst] ? item.status : worst, "healthy");
    return { overall: providers.length ? overall : "unknown", providers };
  }
}

export default CommsHubProviderHealthService;
