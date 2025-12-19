import axios from "axios";

/* ============================================================
   🔑 ENV KEYS
============================================================ */
const SERP_API_KEY = process.env.API_SERP_KEY;
const OPENPAGERANK_KEY = process.env.API_OPENPAGERANK_KEY;

const KEY_URLSCAN = process.env.API_URLSCAN_KEY;
const KEY_PROSPEO = process.env.API_PROSPEO_KEY;
const KEY_HUNTER = process.env.API_HUNTER_KEY;
const KEY_APOLLO = process.env.API_APOLLO_KEY;

/* ============================================================
   ⏱️ RATE CONTROL
============================================================ */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   🚫 DOMAIN BLOCKING (JUNK + NO-REPLY TARGETS)
============================================================ */

// Exact domains (and their subdomains) that never convert
const HARD_BLOCK_DOMAINS = new Set([
  // review / comparison
  "capterra.com","g2.com","trustpilot.com","softwareadvice.com","getapp.com",
  "sourceforge.net","alternativeto.net","stackshare.io","producthunt.com",

  // social / UGC
  "reddit.com","quora.com","linkedin.com","facebook.com","x.com","twitter.com",
  "tiktok.com","youtube.com","medium.com","substack.com","slideshare.net",

  // reference / academic / publishers
  "wikipedia.org","wikidata.org","britannica.com","investopedia.com",
  "forbes.com","hbr.org","mckinsey.com","ibm.com","nature.com","sciencedirect.com",
  "arxiv.org","unesco.org",

  // press release syndication
  "prnewswire.com","businesswire.com","globenewswire.com","einpresswire.com",
  "newswire.com",

  // dev / package / infra
  "github.com","gitlab.com","bitbucket.org","npmjs.com","pypi.org",
  "crates.io","docker.com","hub.docker.com",

  // app stores
  "play.google.com","apps.apple.com",
]);

// Host suffixes that are guaranteed dead ends for outreach
const HARD_BLOCK_SUFFIXES = [
  ".gov",
  ".edu",
  ".ac.uk",
  ".ac.",
];

// Hostname fragments that indicate support/docs/KB systems
const HARD_BLOCK_CONTAINS = [
  "zendesk",
  "support.",
  "help.",
  "kb.",
  "knowledgebase",
  "docs.",
  "developer.",
  "developers.",
  "api.",
];

export function shouldBlockDomain(domain) {
  if (!domain || typeof domain !== "string") {
    return { blocked: true, reason: "invalid_domain" };
  }

  const d = domain.toLowerCase().replace(/^www\./, "");

  // exact + subdomain block
  for (const root of HARD_BLOCK_DOMAINS) {
    if (d === root || d.endsWith(`.${root}`)) {
      return { blocked: true, reason: `blocked:${root}` };
    }
  }

  // suffix block (.gov, .edu, .ac.*)
  for (const suf of HARD_BLOCK_SUFFIXES) {
    if (d.endsWith(suf)) {
      return { blocked: true, reason: "academic_or_gov" };
    }
  }

  // fragment block (zendesk, docs, support, etc.)
  for (const frag of HARD_BLOCK_CONTAINS) {
    if (d.includes(frag)) {
      return { blocked: true, reason: "support_or_docs" };
    }
  }

  return { blocked: false, reason: null };
}

/* ============================================================
   🔍 SERPAPI (LIMIT = 50)
============================================================ */
export async function serpLookup(keyword) {
  if (!SERP_API_KEY) throw new Error("API_SERP_KEY missing");

  const res = await axios.get("https://serpapi.com/search", {
    params: {
      q: keyword,
      engine: "google",
      num: 50,              // 👈 increased as requested
      api_key: SERP_API_KEY,
    },
    timeout: 20000,
  });

  return res.data?.organic_results || [];
}

/* ============================================================
   📊 OPENPAGERANK (AUTHORITY SIGNAL)
============================================================ */
async function getOpenPageRank(domain) {
  if (!OPENPAGERANK_KEY) return null;

  try {
    const res = await axios.get(
      "https://openpagerank.com/api/v1.0/getPageRank",
      {
        params: { "domains[]": domain },
        headers: { "API-OPR": OPENPAGERANK_KEY },
        timeout: 15000,
      }
    );
    return res.data?.response?.[0] || null;
  } catch {
    return null;
  }
}

/* ============================================================
   📰 URLSCAN — LIGHT EDITORIAL HINTS ONLY
============================================================ */
async function getUrlscan(domain) {
  if (!KEY_URLSCAN) return null;
  try {
    const res = await axios.get("https://urlscan.io/api/v1/search/", {
      params: { q: `domain:${domain}` },
      headers: { "API-Key": KEY_URLSCAN },
      timeout: 15000,
    });
    return res.data;
  } catch {
    return null;
  }
}

function detectEditorialHints(domainInfo) {
  if (!domainInfo?.results) return false;

  const text = domainInfo.results
    .map((r) => `${r?.page?.title || ""} ${r?.page?.url || ""}`)
    .join(" ")
    .toLowerCase();

  return (
    text.includes("/blog") ||
    text.includes("/insights") ||
    text.includes("/resources") ||
    text.includes("/news")
  );
}

/* ============================================================
   📧 EMAIL ENRICHMENT
============================================================ */
async function getProspeo(domain) {
  const res = await axios.get("https://api.prospeo.io/api/email-finder", {
    params: { domain },
    headers: { "X-Api-Key": KEY_PROSPEO },
  });
  return res.data;
}

async function getHunter(domain) {
  const res = await axios.get("https://api.hunter.io/v2/domain-search", {
    params: { domain, api_key: KEY_HUNTER },
  });
  return res.data;
}

async function getApollo(domain) {
  const res = await axios.post("https://api.apollo.io/v1/mixed_people/search", {
    api_key: KEY_APOLLO,
    q_organization_domains: [domain],
    page: 1,
    per_page: 10,
  });
  return res.data;
}

/* ============================================================
   🧠 ENRICH DOMAIN
============================================================ */
export async function enrichDomain(domain, serpMeta = {}) {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const block = shouldBlockDomain(d);

  if (block.blocked) {
    return { domain: d, blocked: true, reason: block.reason };
  }

  const emails = new Set();

  if (KEY_PROSPEO) {
    try {
      const p = await getProspeo(d);
      p?.emails?.forEach((e) => e?.email && emails.add(e.email.toLowerCase()));
    } catch {}
  }

  if (KEY_HUNTER) {
    try {
      const h = await getHunter(d);
      h?.data?.emails?.forEach((e) => e?.email && emails.add(e.email.toLowerCase()));
    } catch {}
  }

  if (emails.size < 2 && KEY_APOLLO) {
    try {
      const a = await getApollo(d);
      a?.people?.forEach((p) => p?.email && emails.add(p.email.toLowerCase()));
    } catch {}
  }

  const domainInfo = await getUrlscan(d);
  const hasEditorial = detectEditorialHints(domainInfo);
  const opr = await getOpenPageRank(d);

  const serpPosition = serpMeta.position || null;
  const serpScore = serpPosition ? Math.max(0, 30 - serpPosition) : 0;
  const oprScore = opr?.page_rank_decimal ? opr.page_rank_decimal * 2 : 0;
  const editorialBonus = hasEditorial ? 5 : 0;
  const emailBonus = emails.size ? 5 : 0;

  const totalScore = Math.round(
    serpScore + oprScore + editorialBonus + emailBonus
  );

  return {
    domain: d,
    emails: [...emails],
    authority: {
      serpPosition,
      serpScore,
      openPageRank: opr?.page_rank_decimal ?? null,
      openPageRankRank: opr?.rank ?? null,
      editorialSurface: hasEditorial,
      totalScore,
    },
    blocked: false,
  };
  }
