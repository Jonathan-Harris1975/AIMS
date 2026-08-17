import { info } from "../../../logger.js";
import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";
import { resolveOutreachThresholds } from "../config.js";

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
  const enriched = [];
  for (const d of allowed) {
    enriched.push(await enrichDomain(d.domain, d));
  }

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
  });

  /* ------------------------------
     🎯 POLICY-DRIVEN ACCEPTANCE
  ------------------------------ */
  const thresholds = resolveOutreachThresholds();
  const accepted = enriched.filter(
    (e) =>
      e.authority.totalScore >= thresholds.minAuthorityScore &&
      e.emails.length > 0
  );

  /* ------------------------------
     📈 PRIORITISE FOR REPLIES
  ------------------------------ */
  accepted.sort((a, b) => {
    const tierWeight = { A: 1, B: 2, C: 3 };
    return (
      tierWeight[b.authority.tier] - tierWeight[a.authority.tier] ||
      b.emails.length - a.emails.length ||
      b.authority.totalScore - a.authority.totalScore
    );
  });

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
    acceptedDomains: accepted.length,
    emails: accepted.reduce((a, b) => a + b.emails.length, 0),
    testMode: thresholds.testMode,
    minAuthorityScore: thresholds.minAuthorityScore,
  });

  return {
    keyword,
    domains: enriched,
    acceptedDomains: accepted,
  };
       }
