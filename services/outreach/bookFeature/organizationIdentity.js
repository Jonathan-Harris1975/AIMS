import { createHash } from "node:crypto";
import { retrieveArticle } from "../../script/utils/articleSources.js";

const MAX_FETCHES_PER_ORGANISATION = 4;
const MAX_EVIDENCE_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const IDENTITY_VERSION = "book-feature-identity-v1";

function normalise(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-GB")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function domain(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
  catch { return null; }
}

function organisationMentioned(name, text) {
  const expected = normalise(name);
  const observed = normalise(text);
  if (!expected || expected.length < 3 || !observed) return false;
  return observed.includes(expected);
}

function officialSignals(text) {
  const value = normalise(text);
  return ["about us", "our company", "our organisation", "our organization", "contact us", "registered office"]
    .filter((signal) => value.includes(signal));
}

function evidenceId(name, url, retrievedAt) {
  return createHash("sha256").update(`${normalise(name)}\u001f${url}\u001f${retrievedAt}`).digest("hex");
}

/**
 * Independently fetches source leads through the existing DNS-pinned safe
 * retriever. Search snippets remain leads; only fetched page evidence can
 * establish a current canonical domain. Ambiguous candidates fail closed.
 */
export async function verifyOrganisationIdentities(research, {
  fetchPage = retrieveArticle,
  now = () => new Date(),
} = {}) {
  const rows = Array.isArray(research?.sources) ? research.sources : [];
  const observedAt = now();
  const organisations = [];
  for (const row of rows) {
    const name = String(row?.name || "").trim();
    if (row?.status !== "source_leads_found_unverified" || !name || !Array.isArray(row.sources)) {
      organisations.push({ candidateId: row?.id || null, name: name || null, status: "unverified",
        reason: row?.reason || "no_fetchable_source_leads", evidence: [] });
      continue;
    }
    const evidence = [];
    for (const source of row.sources.slice(0, MAX_FETCHES_PER_ORGANISATION)) {
      const searchedDomain = domain(source?.url);
      if (!searchedDomain) continue;
      try {
        const page = await fetchPage(source.url);
        const canonicalUrl = String(page?.canonicalUrl || source.url);
        const canonicalDomain = domain(canonicalUrl);
        const text = String(page?.text || "").slice(0, 200_000);
        if (!canonicalDomain || !text || !organisationMentioned(name, text)) {
          evidence.push({ sourceUrl: source.url, canonicalUrl, domain: canonicalDomain, status: "rejected",
            reason: "organisation_not_confirmed_on_fetched_page" });
          continue;
        }
        const retrievedAt = observedAt.toISOString();
        evidence.push({ id: evidenceId(name, canonicalUrl, retrievedAt), sourceUrl: source.url,
          canonicalUrl, domain: canonicalDomain, title: String(source.title || "").slice(0, 300),
          retrievedAt, contentHash: createHash("sha256").update(text).digest("hex"),
          signals: officialSignals(text), status: "fetched_name_confirmed" });
      } catch (error) {
        const code = /^article_[a-z0-9_]+$/.test(String(error?.message || "")) ? error.message : "source_fetch_failed";
        evidence.push({ sourceUrl: source.url, domain: searchedDomain, status: "unavailable", reason: code });
      }
    }
    const confirmed = evidence.filter((item) => item.status === "fetched_name_confirmed");
    const official = confirmed.filter((item) => item.signals.length > 0);
    const candidateDomains = [...new Set(official.map((item) => item.domain))];
    let result;
    if (candidateDomains.length !== 1) {
      result = { status: "unverified", reason: candidateDomains.length > 1 ? "contradictory_official_domains" : "official_identity_not_established" };
    } else {
      const officialDomain = candidateDomains[0];
      const corroborated = confirmed.some((item) => item.domain !== officialDomain &&
        normalise(item.title).includes(normalise(name))) || official.filter((item) => item.domain === officialDomain).length >= 2;
      result = corroborated
        ? { status: "verified", reason: null, officialDomain, legalName: name,
          verifiedAt: observedAt.toISOString(), expiresAt: new Date(observedAt.getTime() + MAX_EVIDENCE_AGE_MS).toISOString() }
        : { status: "unverified", reason: "independent_corroboration_missing", officialDomain };
    }
    organisations.push({ candidateId: row.id || null, name, ...result, version: IDENTITY_VERSION, evidence });
  }
  return { organisations, verified: organisations.filter((item) => item.status === "verified").length,
    unverified: organisations.filter((item) => item.status !== "verified").length, version: IDENTITY_VERSION };
}

export const organisationIdentityLimits = Object.freeze({ maxFetchesPerOrganisation: MAX_FETCHES_PER_ORGANISATION,
  maxEvidenceAgeMs: MAX_EVIDENCE_AGE_MS });
