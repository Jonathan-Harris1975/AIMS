import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";

const MAX_DOMAINS_PER_KEYWORD = Number(
  process.env.MAX_DOMAINS_PER_KEYWORD || 25
);

function normaliseHost(host) {
  return String(host || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .trim();
}

export async function serpOutreach(keyword) {
  console.log(`🔍 SERP for keyword: ${keyword}`);

  const serp = await serpLookup(keyword);
  const raw = Array.isArray(serp?.results) ? serp.results : [];

  const domains = [];
  for (const r of raw) {
    try {
      const u = new URL(r.link || r.url);
      const host = normaliseHost(u.hostname);
      if (host) domains.push(host);
    } catch {}
  }

  const uniqueAll = [...new Set(domains)];
  const allowed = [];
  const blocked = [];

  for (const d of uniqueAll) {
    const b = shouldBlockDomain(d);
    if (b.blocked) blocked.push({ domain: d, reason: b.reason });
    else allowed.push(d);

    if (allowed.length >= MAX_DOMAINS_PER_KEYWORD) break;
  }

  console.log(
    `Found ${uniqueAll.length} unique domains ` +
    `(allowed=${allowed.length}/${MAX_DOMAINS_PER_KEYWORD}, blocked=${blocked.length})`
  );

  const enriched = [];
  for (const d of allowed) {
    try {
      enriched.push(await enrichDomain(d));
    } catch (err) {
      console.log(`❌ enrichDomain failed for ${d}: ${err.message}`);
      enriched.push({
        domain: d,
        emails: [],
        editorial: { hasEditorialSurface: false, signals: [] }
      });
    }
  }

  // ZeroBounce once per keyword
  const allEmails = enriched.flatMap(e => e.emails);
  const validationMap = await batchValidateEmails(allEmails);

  let goodDomains = 0;
  let goodEmails = 0;

  for (const e of enriched) {
    e.emails = e.emails.map(email => {
      const v = validationMap.get(email) || { status: "unknown" };

      let score = 0.25;
      if (v.status === "valid") score = 1;
      else if (v.status === "catch-all") score = 0.55;
      else if (v.status === "unknown") score = 0.3;
      else score = 0.1;

      if (score >= 0.55) goodEmails++;

      return { email, validation: v, score };
    });

    if (e.emails.some(m => m.score >= 0.55)) goodDomains++;
  }

  console.log(
    `✅ Keyword "${keyword}" → ${goodDomains} good domains, ${goodEmails} good emails`
  );

  return { keyword, domains: enriched };
                                  }
