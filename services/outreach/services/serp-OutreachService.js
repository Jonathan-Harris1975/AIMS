import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";

function normaliseHost(host) {
  return host.toLowerCase().replace(/^www\./, "");
}

export async function serpOutreach(keyword) {
  console.log(`🔍 SERP for keyword: ${keyword}`);

  const results = await serpLookup(keyword);
  console.log(`🔎 SERPAPI results for "${keyword}": ${results.length}`);

  const domains = [];
  results.forEach((r) => {
    try {
      const u = new URL(r.link);
      domains.push({
        domain: normaliseHost(u.hostname),
        position: r.position,
      });
    } catch {}
  });

  const unique = new Map();
  domains.forEach((d) => {
    if (!unique.has(d.domain)) unique.set(d.domain, d);
  });

  const allowed = [];
  const blocked = [];

  for (const d of unique.values()) {
    const b = shouldBlockDomain(d.domain);
    if (b.blocked) blocked.push(d.domain);
    else allowed.push(d);
  }

  console.log(
    `Found ${unique.size} unique domains (allowed=${allowed.length}, blocked=${blocked.length})`
  );

  const enriched = [];
  for (const d of allowed) {
    enriched.push(await enrichDomain(d.domain, d));
  }

  const allEmails = enriched.flatMap((e) => e.emails);
  const validation = await batchValidateEmails(allEmails);

  enriched.forEach((e) => {
    e.emails = e.emails.map((email) => {
      const v = validation.get(email) || { status: "unknown" };
      return { email, validation: v };
    });
  });

  const goodDomains = enriched.filter(
    (e) => e.authority?.totalScore >= 25 && e.emails.length
  );

  console.log(
    `✅ Keyword "${keyword}" → ${goodDomains.length} good domains, ${goodDomains.reduce(
      (a, b) => a + b.emails.length,
      0
    )} good emails`
  );

  return { keyword, domains: enriched };
}
