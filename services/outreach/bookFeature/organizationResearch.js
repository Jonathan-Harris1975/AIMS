import { tavilySearch } from "../../kdp/researchDiscovery.js";

const MAX_SEARCHED_ORGANISATIONS = 5;
const ELIGIBLE_TYPES = new Set(["company", "product", "research_body", "association"]);
const NON_PROMOTIONAL_CONTEXT = new Set(["critical", "mixed", "unclear"]);

function safeName(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function safeText(value, limit) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeSource(source) {
  let url;
  try { url = new URL(source?.url); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return { title: safeText(source.title, 300), url: url.href,
    snippet: safeText(source.snippet, 1000), published: safeText(source.published, 50) || null,
    fetched: safeText(source.fetched, 50) || null };
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
} = {}) {
  if (!Array.isArray(entities)) throw new TypeError("Book Feature entities must be an array.");
  const selected = [];
  const rows = [];
  for (const entity of entities) {
    const name = safeName(entity?.name);
    if (!name) {
      rows.push({ id: entity?.id || null, name: null, status: "not_researched", reason: "candidate_name_missing" });
      continue;
    }
    const blocked = researchStatus(entity || {});
    if (blocked) {
      rows.push({ id: entity.id || null, name, ...blocked, sources: [] });
      continue;
    }
    if (selected.length >= MAX_SEARCHED_ORGANISATIONS) {
      rows.push({ id: entity.id || null, name, status: "deferred", reason: "per_run_research_limit", sources: [] });
      continue;
    }
    selected.push({ entity, name });
  }

  for (const { entity, name } of selected) {
    if (!apiKey) {
      rows.push({ id: entity.id || null, name, status: "unavailable", reason: "search_not_configured", sources: [] });
      continue;
    }
    const query = `"${name.replace(/["\\]/g, " ")}" official organisation website products`;
    const retrievedAt = now().toISOString();
    try {
      const found = await search({ query, country: "GB", freshness: "pm", apiKey });
      const sources = (Array.isArray(found) ? found : []).map(safeSource).filter(Boolean);
      rows.push({ id: entity.id || null, name, query, provider: "tavily", retrievedAt,
        status: sources.length ? "source_leads_found_unverified" : "no_source_leads_found",
        sources });
    } catch (error) {
      rows.push({ id: entity.id || null, name, query, provider: "tavily", retrievedAt,
        status: "search_failed", reason: String(error?.code || "research_provider_error").slice(0, 100), sources: [] });
    }
  }

  return { sources: rows, searched: selected.length, notResearched: rows.filter((row) => row.status === "not_researched").length,
    deferred: rows.filter((row) => row.status === "deferred").length,
    unverified: true, verifiedOrganisations: 0, contactEligibleOpportunities: 0 };
}

export const organizationResearchLimits = Object.freeze({ maxSearchedOrganisations: MAX_SEARCHED_ORGANISATIONS });
