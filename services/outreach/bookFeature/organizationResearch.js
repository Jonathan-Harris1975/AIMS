import { tavilySearch } from "../../kdp/researchDiscovery.js";
import { createHash } from "node:crypto";
import net from "node:net";
import { getObjectAsText, putPrivateJson } from "../../shared/utils/r2-client.js";

const MAX_SEARCHED_ORGANISATIONS = 5;
const ELIGIBLE_TYPES = new Set(["company", "product", "research_body", "association"]);
const NON_PROMOTIONAL_CONTEXT = new Set(["critical", "mixed", "unclear"]);
const MAX_SOURCES_PER_ORGANISATION = 6;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = "book-feature-source-leads-v1";

function safeName(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function safeText(value, limit) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeSource(source) {
  let url;
  try { url = new URL(source?.url); } catch { return null; }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      net.isIP(hostname) || !hostname.includes(".") || hostname === "localhost" ||
      hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.endsWith(".invalid")) return null;
  url.hash = "";
  return { title: safeText(source?.title, 300), url: url.href,
    snippet: safeText(source?.snippet, 1000), published: safeText(source?.published, 50) || null,
    fetched: safeText(source?.fetched, 50) || null };
}

function researchStatus(entity) {
  if (!ELIGIBLE_TYPES.has(entity.entityType)) return { status: "not_researched", reason: "not_an_organisation_or_product" };
  if (NON_PROMOTIONAL_CONTEXT.has(entity.sentiment) || entity.mentionType === "historical" ||
      entity.mentionType === "unclear" || !Number.isInteger(entity.confidence) ||
      entity.confidence < 60 || entity.confidence > 100) {
    return { status: "not_researched", reason: "context_not_suitable_for_promotional_research" };
  }
  return null;
}

/**
 * Collects current source leads for a small, fixed number of manuscript
 * candidates. Search results are evidence leads only; this never verifies an
 * organisation, domain, ownership, contact, permission or outreach eligibility.
 */
export async function researchCandidateSources(entities, {
  apiKey = process.env.TAVILY_SEARCH_API,
  search = tavilySearch,
  now = () => new Date(),
  readCache = getObjectAsText,
  writeCache = putPrivateJson,
} = {}) {
  if (!Array.isArray(entities)) throw new TypeError("Book Feature entities must be an array.");
  const selected = [];
  const rows = [];
  const seenNames = new Map();
  for (const [index, entity] of entities.entries()) {
    const name = safeName(entity?.name);
    if (!name) {
      rows[index] = { id: entity?.id || null, name: null, status: "not_researched", reason: "candidate_name_missing" };
      continue;
    }
    const blocked = researchStatus(entity || {});
    if (blocked) {
      rows[index] = { id: entity.id || null, name, ...blocked, sources: [] };
      continue;
    }
    const nameKey = name.normalize("NFKC").toLocaleLowerCase("en-GB");
    if (seenNames.has(nameKey)) {
      rows[index] = { id: entity.id || null, name, status: "duplicate_candidate", reason: "organisation_name_already_researched",
        duplicateOf: seenNames.get(nameKey), sources: [] };
      continue;
    }
    if (selected.length >= MAX_SEARCHED_ORGANISATIONS) {
      rows[index] = { id: entity.id || null, name, status: "deferred", reason: "per_run_research_limit", sources: [] };
      continue;
    }
    seenNames.set(nameKey, entity.id || name);
    selected.push({ entity, name, index });
  }

  for (const { entity, name, index } of selected) {
    const query = `"${name.replace(/["\\]/g, " ")}" official organisation website products`;
    const nameKey = name.normalize("NFKC").toLocaleLowerCase("en-GB");
    const cacheKey = `outreach/book-feature/source-leads/${createHash("sha256").update(nameKey).digest("hex")}.json`;
    const retrievedAt = now().toISOString();
    let cacheRead = "miss";
    try {
      const raw = await readCache("kdp", cacheKey);
      let cached = null;
      try { cached = JSON.parse(raw); } catch { /* Corrupt cache entries are replaced by a fresh bounded lookup. */ }
      const cachedAt = Date.parse(cached?.retrievedAt || "");
      const expiresAt = Date.parse(cached?.expiresAt || "");
      const validCache = cached?.version === CACHE_VERSION && cached?.nameKey === nameKey &&
        Number.isFinite(cachedAt) && cachedAt <= Date.parse(retrievedAt) && Number.isFinite(expiresAt) &&
        expiresAt > Date.parse(retrievedAt) && expiresAt - cachedAt <= CACHE_TTL_MS &&
        Array.isArray(cached.sources) && cached.sources.length <= MAX_SOURCES_PER_ORGANISATION;
      if (validCache) {
        const sources = cached.sources.map(safeSource).filter(Boolean).slice(0, MAX_SOURCES_PER_ORGANISATION);
        rows[index] = { id: entity.id || null, name, query, provider: "tavily", retrievedAt: cached.retrievedAt,
          cache: { read: "hit", write: "not_needed" }, status: sources.length ? "source_leads_found_unverified" : "no_source_leads_found", sources };
        continue;
      }
    } catch (error) {
      if (!apiKey) {
        rows[index] = { id: entity.id || null, name, status: "unavailable", reason: "search_not_configured",
          cache: { read: "unavailable", write: "not_attempted" }, sources: [] };
        continue;
      }
      if (!(["NoSuchKey", "NotFound"].includes(error?.name) || error?.$metadata?.httpStatusCode === 404)) {
        cacheRead = "failed";
      }
    }
    if (!apiKey) {
      rows[index] = { id: entity.id || null, name, status: "unavailable", reason: "search_not_configured", sources: [] };
      continue;
    }
    try {
      const found = await search({ query, country: "GB", freshness: "pm", apiKey });
      const sources = (Array.isArray(found) ? found : []).map(safeSource).filter(Boolean)
        .filter((source, index, all) => all.findIndex((candidate) => candidate.url === source.url) === index)
        .slice(0, MAX_SOURCES_PER_ORGANISATION);
      let cacheWrite = "failed";
      try {
        await writeCache("kdp", cacheKey, { version: CACHE_VERSION, nameKey, retrievedAt,
          expiresAt: new Date(Date.parse(retrievedAt) + CACHE_TTL_MS).toISOString(), sources });
        cacheWrite = "written";
      } catch { /* Keep the observed leads; the next run can safely search again. */ }
      rows[index] = { id: entity.id || null, name, query, provider: "tavily", retrievedAt,
        cache: { read: cacheRead, write: cacheWrite },
        status: sources.length ? "source_leads_found_unverified" : "no_source_leads_found",
        sources };
    } catch (error) {
      rows[index] = { id: entity.id || null, name, query, provider: "tavily", retrievedAt,
        status: "search_failed", reason: String(error?.code || "research_provider_error").slice(0, 100), sources: [] };
    }
  }

  return { sources: rows.filter(Boolean), searched: selected.length, notResearched: rows.filter((row) => row.status === "not_researched").length,
    deferred: rows.filter((row) => row.status === "deferred").length,
    unverified: true, verifiedOrganisations: 0, contactEligibleOpportunities: 0 };
}

export const organizationResearchLimits = Object.freeze({ maxSearchedOrganisations: MAX_SEARCHED_ORGANISATIONS });
