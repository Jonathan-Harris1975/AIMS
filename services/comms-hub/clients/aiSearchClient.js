import { CommsHubError } from "../errors.js";
import { sha256Hex } from "../domain/ids.js";


async function recordKnowledgeOutcome(outcome) {
  try {
    const { recordProviderOutcome } = await import("../../shared/utils/operationalExcellence.js");
    recordProviderOutcome(outcome);
  } catch {
    // Provider telemetry must never make knowledge retrieval unavailable.
  }
}

async function sharedFetch(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}

function text(value, max = 20_000) {
  return String(value ?? "").trim().slice(0, max);
}

function candidateChunks(payload) {
  const result = payload?.result;
  const candidates = [
    result?.data,
    result?.chunks,
    result?.results,
    payload?.data,
    payload?.chunks,
    payload?.results,
    Array.isArray(result) ? result : null,
  ];
  return candidates.find(Array.isArray) || [];
}

function normaliseChunk(chunk, indexId, position) {
  const excerpt = text(
    chunk?.text
      ?? chunk?.content
      ?? chunk?.page_content
      ?? chunk?.chunk?.text
      ?? chunk?.chunk?.content,
    12_000
  );
  if (!excerpt) return null;
  const metadata = {
    ...(chunk?.item?.metadata && typeof chunk.item.metadata === "object" ? chunk.item.metadata : {}),
    ...(chunk?.metadata && typeof chunk.metadata === "object" ? chunk.metadata : {}),
  };
  const sourceReference = text(
    chunk?.source
      ?? chunk?.source_url
      ?? chunk?.url
      ?? chunk?.item?.key
      ?? chunk?.item_id
      ?? chunk?.id
      ?? metadata.source
      ?? metadata.url
      ?? metadata.key
      ?? `${indexId}:chunk:${position}`,
    2000
  );
  return Object.freeze({
    indexId,
    sourceReference,
    title: text(chunk?.title ?? metadata.title ?? metadata.filename, 500),
    excerpt,
    score: Number.isFinite(Number(chunk?.score ?? chunk?.similarity)) ? Number(chunk?.score ?? chunk?.similarity) : null,
    contentSha256: sha256Hex(excerpt),
    metadata,
  });
}

export class AiSearchClient {
  constructor(config, { fetchImpl = sharedFetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.lastSearchDiagnostics = Object.freeze({ ok: true, degraded: false, successfulInstances: 0, failedInstances: [] });
  }

  async searchInstance(instanceId, query, { maxResults = 6 } = {}) {
    const startedAt = Date.now();
    const routeKey = `comms-hub:knowledge:${instanceId}`;
    if (!this.config.aiSearchApprovedInstances.includes(instanceId)) {
      throw new CommsHubError(403, "ai_search_instance_unapproved", `AI Search instance '${instanceId}' is not approved for Comms Hub grounding.`, {
        failureClass: "permanent",
        publicMessage: "The requested knowledge source is not approved.",
      });
    }
    const endpoint = `${this.config.cloudflareApiBaseUrl}/accounts/${this.config.cloudflareAccountId}/ai-search/instances/${encodeURIComponent(instanceId)}/search`;
    let response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        timeout: this.config.aiSearchTimeoutMs,
        headers: {
          authorization: `Bearer ${this.config.aiSearchApiToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: text(query, 8000) }],
          max_num_results: Math.max(1, Math.min(20, Number(maxResults) || 6)),
        }),
      });
    } catch (cause) {
      await recordKnowledgeOutcome({ routeKey, provider: "cloudflare-ai-search", ok: false, durationMs: Date.now() - startedAt, status: "unreachable" });
      throw new CommsHubError(502, "ai_search_unreachable", "Cloudflare AI Search could not be reached.", {
        cause,
        retryable: true,
        failureClass: "temporary",
        publicMessage: "Knowledge search is temporarily unavailable.",
      });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false || !payload) {
      await recordKnowledgeOutcome({ routeKey, provider: "cloudflare-ai-search", ok: false, durationMs: Date.now() - startedAt, status: String(response.status || "failed") });
      throw new CommsHubError(response.status === 429 ? 429 : 502, "ai_search_failed", `AI Search failed with HTTP ${response.status}.`, {
        retryable: response.status === 429 || response.status >= 500,
        failureClass: response.status === 429 || response.status >= 500 ? "temporary" : "permanent",
        publicMessage: "Knowledge search failed.",
      });
    }
    const results = candidateChunks(payload)
      .map((chunk, index) => normaliseChunk(chunk, instanceId, index))
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(20, Number(maxResults) || 6)));
    await recordKnowledgeOutcome({ routeKey, provider: "cloudflare-ai-search", ok: true, durationMs: Date.now() - startedAt, status: results.length ? "success" : "empty" });
    return results;
  }

  async searchApproved(query, { maxResultsPerInstance = 4, maximumEvidence = 8 } = {}) {
    if (!this.config.aiSearchApprovedInstances.length) {
      throw new CommsHubError(503, "ai_search_unconfigured", "No approved AI Search instances are configured.", {
        failureClass: "permanent",
        publicMessage: "Knowledge grounding is not configured.",
      });
    }
    const settled = await Promise.allSettled(
      this.config.aiSearchApprovedInstances.map((instanceId) => this.searchInstance(instanceId, query, { maxResults: maxResultsPerInstance }))
    );
    const evidence = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const failures = settled.flatMap((result, index) => result.status === "rejected" ? [{
      instanceId: this.config.aiSearchApprovedInstances[index],
      code: result.reason?.code || result.reason?.name || "ai_search_failed",
      statusCode: result.reason?.statusCode || null,
    }] : []);
    const successfulInstances = settled.length - failures.length;
    this.lastSearchDiagnostics = Object.freeze({
      ok: successfulInstances > 0,
      degraded: failures.length > 0,
      successfulInstances,
      failedInstances: Object.freeze(failures.map((item) => Object.freeze(item))),
      evidenceCount: evidence.length,
    });
    // Runtime indexing/search failures are deliberately non-blocking. AIMS can
    // still draft from the conversation, while evidence-required workflows are
    // forced to human review when no approved evidence is available.
    return evidence
      .sort((left, right) => Number(right.score ?? -1) - Number(left.score ?? -1))
      .slice(0, Math.max(1, Math.min(30, Number(maximumEvidence) || 8)));
  }
}

export default AiSearchClient;
