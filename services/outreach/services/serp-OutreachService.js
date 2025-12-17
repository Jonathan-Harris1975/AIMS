import { serpLookup, enrichDomain, shouldBlockDomain } from "./outreachCore.js";
import { batchValidateEmails } from "./zeroBounceBatch.js";

// Optimised, ENV-driven domain cap
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
    } catch {
      // ignore malformed URLs
    }
  }

  const uniqueAll = [...new Set(domains)];
  const allowed = [];
  const blocked = [];

  for (const d of uniqueAll) {
    const b = shouldBlockDomain(d);
    if (b.blocked) {
      blocked.push({ domain: d, reason: b.reason });
    } else {
      allowed.push(d);
    }

    if (allowed.length >= MAX_DOMAINS_PER_KEYWORD) break;
  }

  console.log(
    `Found ${uniqueAll.length} unique domains ` +
    `(allowed=${allowed.length}/${MAX_DOMAINS_PER_KEYWORD}, blocked=${blocked.length})`
  );

  if (blocked.length) {
    console.log(
      `🧱 Blocked: ${blocked
        .slice(0, 8)
        .map((x) => `${x.domain}(${x.reason})`)
        .join(", ")}${blocked.length > 8 ? " …" : ""}`
    );
  }

  const enriched = [];

  for (const d of allowed) {
    try {
      enriched.push(await enrichDomain(d));
    } catch (err) {
      console.log(`❌ enrichDomain failed for ${d}: ${err.message}`);
      enriched.push({
        domain: d,
        emails: [],
        domainInfo: null,
        blocked: false,
        blockReason: null,
        editorial: {
          hasEditorialSurface: false,
          signals: [],
        },
      });
    }
  }

  // ZeroBounce once per keyword (non-fatal)
  const allEmails = enriched.flatMap((e) => e.emails);
  const validationMap = await batchValidateEmails(allEmails);

  for (const e of enriched) {
    e.emails = e.emails.map((email) => {
      const v = validationMap.get(email) || { status: "unknown" };

      // Conservative scoring
      let score = 0.25;
      if (v.status === "valid") score = 1;
      else if (v.status === "catch-all") score = 0.55;
      else if (v.status === "unknown") score = 0.3;
      else score = 0.1;

      return { email, validation: v, score };
    });

    // Metadata preserved for downstream filters
    e.meta = {
      editorialSurface: Boolean(e.editorial?.hasEditorialSurface),
      editorialSignals: e.editorial?.signals || [],
      blocked: Boolean(e.blocked),
      blockReason: e.blockReason || null,
    };
  }

  return { keyword, domains: enriched };
        }
