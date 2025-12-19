import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";

/* ============================================================
   🧠 TIER LOGIC (REPLY-RATE OPTIMISED)
============================================================ */
function classifyTier(score) {
  if (score >= 35) return "A"; // Big sites, low replies
  if (score >= 22) return "B"; // Solid mid-range
  if (score >= 12) return "C"; // Small / niche — best replies
  return "D";                 // Junk
}

function normaliseHost(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "").trim();
}

/* ============================================================
   🚀 MAIN OUTREACH FUNCTION
============================================================ */
export async function serpOutreach(keyword) {
  console.log(`🔍 SERP for keyword: ${keyword}`);

  const serpResults = await serpLookup(keyword);
  console.log(`🔎 SERPAPI results for "${keyword}": ${serpResults.length}`);

  /* --------------------------------------------
     🌐 EXTRACT UNIQUE DOMAINS (NO HARD LIMIT)
  -------------------------------------------- */
  const domainMap = new Map();

  serpResults.forEach((r) => {
    try {
      const url = new URL(r.link);
      const domain = normaliseHost(url.hostname);

      if (!domainMap.has(domain)) {
        domainMap.set(domain, {
          domain,
          position: r.position || null,
        });
      }
    } catch {}
  });

  const uniqueDomains = [...domainMap.values()];

  /* --------------------------------------------
     🚫 BLOCK JUNK DOMAINS
  -------------------------------------------- */
  const allowed = [];
  const blocked = [];

  uniqueDomains.forEach((d) => {
    const b = shouldBlockDomain(d.domain);
    if (b.blocked) blocked.push(d.domain);
    else allowed.push(d);
  });

  console.log(
    `Found ${uniqueDomains.length} unique domains (allowed=${allowed.length}, blocked=${blocked.length})`
  );

  /* --------------------------------------------
     🧬 ENRICH DOMAINS
  -------------------------------------------- */
  const enriched = [];
  for (const d of allowed) {
    enriched.push(await enrichDomain(d.domain, d));
  }

  /* --------------------------------------------
     📧 EMAIL VALIDATION (BATCH)
  -------------------------------------------- */
  const allEmails = enriched.flatMap((e) => e.emails);
  const validationMap = await batchValidateEmails(allEmails);

  enriched.forEach((e) => {
    e.emails = e.emails.map((email) => {
      const v = validationMap.get(email) || { status: "unknown" };
      return { email, validation: v };
    });
  });

  /* --------------------------------------------
     🏷️ ASSIGN TIERS
  -------------------------------------------- */
  enriched.forEach((e) => {
    e.authority.tier = classifyTier(e.authority.totalScore);
  });

  /* --------------------------------------------
     🎯 ADAPTIVE FILTERING (REPLY-RATE AWARE)
  -------------------------------------------- */
  let accepted = enriched.filter(
    (e) =>
      e.authority.tier !== "D" &&
      e.emails.length > 0
  );

  // If yield is poor, relax slightly (never junk)
  if (accepted.length < 3) {
    accepted = enriched.filter(
      (e) =>
        e.authority.totalScore >= 8 &&
        e.emails.length > 0
    );
  }

  /* --------------------------------------------
     📈 PRIORITISE BY REPLY PROBABILITY
  -------------------------------------------- */
  accepted.sort((a, b) => {
    const tierWeight = { A: 1, B: 2, C: 3 };
    return (
      tierWeight[b.authority.tier] - tierWeight[a.authority.tier] ||
      b.emails.length - a.emails.length ||
      b.authority.totalScore - a.authority.totalScore
    );
  });

  /* --------------------------------------------
     📊 DEBUG VISIBILITY (CRITICAL)
  -------------------------------------------- */
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
