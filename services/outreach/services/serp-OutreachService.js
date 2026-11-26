import { info } from "../../../logger.js";
import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";
import { resolveOutreachThresholds } from "../config.js";
import { relevanceScore } from "../utils/qualification.js";

/* ============================================================
   🧠 REPLY-RATE–AWARE SCORING
============================================================ */

function classifyTier(score) {
  if (score >= 32) return "A";   // big brands, low replies
  if (score >= 22) return "B";   // solid mid-range
  if (score >= 14) return "C";   // small / niche — best replies
  return "D";                    // junk
}

function normaliseHost(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "").trim();
}

export function sortEditorialOpportunities(domains = []) {
  const tierWeight = { A: 1, B: 2, C: 3, D: 4 };
  return [...domains].sort((a, b) =>
    (Number(b.editorialRelevanceScore || 0) - Number(a.editorialRelevanceScore || 0)) ||
    (Number(b.editorialEvidence?.classification === "confirmed") - Number(a.editorialEvidence?.classification === "confirmed")) ||
    (Number(b.editorialEvidence?.recentActivity === true) - Number(a.editorialEvidence?.recentActivity === true)) ||
    ((b.emails?.length || 0) - (a.emails?.length || 0)) ||
    ((tierWeight[b.authority?.tier] || 0) - (tierWeight[a.authority?.tier] || 0)) ||
    (Number(b.authority?.totalScore || 0) - Number(a.authority?.totalScore || 0))
  );
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

/* ============================================================
   🚀 SERP OUTREACH
============================================================ */

export async function serpOutreach(keyword) {
  info("outreach.serp.start", { keyword });

  const serpResults = await serpLookup(keyword);
  info("outreach.serp.results", { keyword, results: serpResults.length });

  /* ------------------------------
     🌐 UNIQUE DOMAINS
  ------------------------------ */
  const domainMap = new Map();

  serpResults.forEach((r) => {
    try {
      const u = new URL(r.link);
      const d = normaliseHost(u.hostname);
      if (!domainMap.has(d)) {
        domainMap.set(d, { domain: d, position: r.position || null, sourceUrl: r.link || null, sourceTitle: r.title || null, sourceSnippet: r.snippet || null });
      }
    } catch {}
  });

  const uniqueDomains = [...domainMap.values()];

  /* ------------------------------
     🚫 BLOCK JUNK
  ------------------------------ */
  const allowed = [];
  const blocked = [];

  uniqueDomains.forEach((d) => {
    const b = shouldBlockDomain(d.domain);
    if (b.blocked) blocked.push({ domain: d.domain, reason: b.reason });
    else allowed.push(d);
  });

  info("outreach.serp.domainSummary", {
    keyword,
    uniqueDomains: uniqueDomains.length,
    allowed: allowed.length,
    blocked: blocked.length,
  });

  /* ------------------------------
     🧬 ENRICH
  ------------------------------ */
  const maxDomains = Math.max(1, Math.min(50, Number(process.env.OUTREACH_MAX_DOMAINS_PER_SEARCH) || 20));
  const boundedAllowed = allowed.slice(0, maxDomains);
  const enriched = await mapWithConcurrency(boundedAllowed, 3, (d) => enrichDomain(d.domain, d));

  /* ------------------------------
     📧 EMAIL VALIDATION
  ------------------------------ */
  const allEmails = enriched.flatMap((e) => e.emails);
  const validationMap = await batchValidateEmails(allEmails);

  enriched.forEach((e) => {
    e.emails = e.emails.map((email) => {
      const v = validationMap.get(email) || { status: "unknown" };
      const hunter = Array.isArray(e.emailCandidates) ? e.emailCandidates.find((item) => item.email === email) : null;
      return { email, validation: v, hunter };
    });
  });

  /* ------------------------------
     🏷️ TIERS
  ------------------------------ */
  enriched.forEach((e) => {
    e.authority.tier = classifyTier(e.authority.totalScore);
    e.editorialRelevanceScore = relevanceScore(keyword, e.editorialEvidence);
  });

  /* ------------------------------
     🎯 POLICY-DRIVEN ACCEPTANCE
  ------------------------------ */
  const thresholds = resolveOutreachThresholds();
  const accepted = enriched.filter((e) =>
    ["confirmed", "strong_probable"].includes(e.editorialEvidence?.classification) && e.emails.length > 0
  );

  /* ------------------------------
     📈 PRIORITISE FOR REPLIES
  ------------------------------ */
  const prioritised = sortEditorialOpportunities(accepted);

  /* ------------------------------
     📊 VISIBILITY
  ------------------------------ */
  info("outreach.serp.scored", {
    keyword,
    domains: enriched.map((e) => ({
      domain: e.domain,
      score: e.authority.totalScore,
      tier: e.authority.tier,
      emails: e.emails.length,
    })),
  });

  info("outreach.serp.accepted", {
    keyword,
    acceptedDomains: prioritised.length,
    emails: prioritised.reduce((a, b) => a + b.emails.length, 0),
    evidenceQualifiedDomains: prioritised.length,
    testMode: thresholds.testMode,
    policy: "evidence-first",
  });

  return {
    keyword,
    domains: enriched,
    acceptedDomains: prioritised,
  };
       }
