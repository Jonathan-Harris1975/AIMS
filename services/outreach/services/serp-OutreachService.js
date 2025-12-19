import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";

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
  console.log(`🔍 SERP for keyword: ${keyword}`);

  const serpResults = await serpLookup(keyword);
  console.log(`🔎 SERPAPI results for "${keyword}": ${serpResults.length}`);

  /* ------------------------------
     🌐 UNIQUE DOMAINS
  ------------------------------ */
  const domainMap = new Map();

  serpResults.forEach((r) => {
    try {
      const u = new URL(r.link);
      const d = normaliseHost(u.hostname);
      if (!domainMap.has(d)) {
        domainMap.set(d, { domain: d, position: r.position || null });
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

  console.log(
    `Found ${uniqueDomains.length} unique domains (allowed=${allowed.length}, blocked=${blocked.length})`
  );

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
      return { email, validation: v };
    });
  });

  /* ------------------------------
     🏷️ TIERS
  ------------------------------ */
  enriched.forEach((e) => {
    e.authority.tier = classifyTier(e.authority.totalScore);
  });

  /* ------------------------------
     🎯 ADAPTIVE ACCEPTANCE
  ------------------------------ */
  let accepted = enriched.filter(
    (e) =>
      e.authority.tier !== "D" &&
      e.emails.length > 0
  );

  // Relax if yield is poor (never allow junk)
  if (accepted.length < 3) {
    accepted = enriched.filter(
      (e) =>
        e.authority.totalScore >= 10 &&
        e.emails.length > 0
    );
  }

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
  console.table(
    enriched.map((e) => ({
      domain: e.domain,
      score: e.authority.totalScore,
      tier: e.authority.tier,
      emails: e.emails.length,
    }))
  );

  console.log(
    `✅ Keyword "${keyword}" → ${accepted.length} viable domains, ${accepted.reduce(
      (a, b) => a + b.emails.length,
      0
    )} emails`
  );

  return {
    keyword,
    domains: enriched,
    acceptedDomains: accepted,
  };
       }
