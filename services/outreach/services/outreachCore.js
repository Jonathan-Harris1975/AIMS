import axios from "axios";

/* ================= ENV KEYS ================= */

const KEY_SERPAPI = process.env.API_SERP_KEY;
const KEY_URLSCAN = process.env.API_URLSCAN_KEY;
const KEY_PROSPEO = process.env.API_PROSPEO_KEY;
const KEY_HUNTER = process.env.API_HUNTER_KEY;
const KEY_APOLLO = process.env.API_APOLLO_KEY;

/* ================= BASE URLS ================= */

const URLSCAN_BASE = "https://urlscan.io/api/v1";
const PROSPEO_BASE = "https://api.prospeo.io";
const HUNTER_BASE = "https://api.hunter.io";
const APOLLO_BASE = "https://api.apollo.io";

/* ================= CONFIG ================= */

const SERP_RESULT_LIMIT = Number(process.env.SERP_RESULT_LIMIT || 30);
const HUNTER_DELAY_MS = Number(process.env.HUNTER_DELAY_MS || 500);
const APOLLO_DELAY_MS = Number(process.env.APOLLO_DELAY_MS || 800);
const URLSCAN_DELAY_MS = Number(process.env.URLSCAN_DELAY_MS || 2000);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= DOMAIN FILTERING ================= */

const HARD_BLOCK_DOMAINS = new Set([
  "capterra.com","g2.com","trustpilot.com","softwareadvice.com","getapp.com",
  "sourceforge.net","alternativeto.net","stackshare.io","producthunt.com",
  "reddit.com","quora.com","linkedin.com","facebook.com","x.com","twitter.com",
  "tiktok.com","youtube.com","medium.com","substack.com","slideshare.net",
  "wikipedia.org","wikidata.org","britannica.com","investopedia.com",
  "prnewswire.com","businesswire.com","globenewswire.com","einpresswire.com",
  "newswire.com","github.com","gitlab.com","bitbucket.org","npmjs.com",
  "pypi.org","crates.io","docker.com","hub.docker.com",
  "play.google.com","apps.apple.com",
]);

const HARD_BLOCK_HOST_PATTERNS = [
  /\.gov(\.|$)/i,
  /\.edu(\.|$)/i,
  /\.ac\.uk(\.|$)/i,
  /(^|\.)github\.io$/i,
  /(^|\.)vercel\.app$/i,
  /(^|\.)netlify\.app$/i,
  /(^|\.)wixsite\.com$/i,
  /(^|\.)sites\.google\.com$/i,
  /(^|\.)webflow\.io$/i,
];

const HARD_BLOCK_TLDS = new Set(["tk","ml","ga","cf","gq","top","click","link","live"]);

export function shouldBlockDomain(domain) {
  if (!domain || typeof domain !== "string") {
    return { blocked: true, reason: "invalid_domain" };
  }

  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!d || d.includes("..")) return { blocked: true, reason: "invalid_domain" };

  for (const root of HARD_BLOCK_DOMAINS) {
    if (d === root || d.endsWith(`.${root}`)) {
      return { blocked: true, reason: `hard_block:${root}` };
    }
  }

  for (const re of HARD_BLOCK_HOST_PATTERNS) {
    if (re.test(d)) return { blocked: true, reason: "hard_block:host_pattern" };
  }

  const tld = d.split(".").pop();
  if (HARD_BLOCK_TLDS.has(tld)) {
    return { blocked: true, reason: `hard_block:tld:${tld}` };
  }

  return { blocked: false, reason: null };
}

/* ================= SERP (SerpAPI) ================= */

export async function serpLookup(keyword) {
  if (!KEY_SERPAPI) throw new Error("API_SERP_KEY missing");

  const res = await axios.get("https://serpapi.com/search", {
    params: {
      api_key: KEY_SERPAPI,
      engine: "google",
      q: keyword,
      num: SERP_RESULT_LIMIT,
    },
    timeout: 20000,
  });

  const organic = Array.isArray(res.data?.organic_results)
    ? res.data.organic_results
    : [];

  console.log(`🔎 SERPAPI results for "${keyword}": ${organic.length}`);

  return {
    results: organic.map((r) => ({
      link: r.link,
      position: r.position,
      title: r.title,
      snippet: r.snippet,
    })),
  };
}

/* ================= URLSCAN (NON-BLOCKING) ================= */

async function getUrlscan(domain) {
  if (!KEY_URLSCAN) return null;

  try {
    const res = await axios.get(`${URLSCAN_BASE}/search/`, {
      params: { q: `domain:${domain}` },
      headers: { "API-Key": KEY_URLSCAN },
      timeout: 15000,
    });
    await wait(URLSCAN_DELAY_MS);
    return res.data;
  } catch {
    return null;
  }
}

/* ================= ENRICHMENT PROVIDERS ================= */

async function getProspeo(domain) {
  const res = await axios.get(`${PROSPEO_BASE}/api/email-finder`, {
    params: { domain },
    headers: { "X-Api-Key": KEY_PROSPEO },
    timeout: 15000,
  });
  return res.data;
}

async function getHunter(domain) {
  const res = await axios.get(`${HUNTER_BASE}/v2/domain-search`, {
    params: { domain, api_key: KEY_HUNTER },
    timeout: 15000,
  });
  await wait(HUNTER_DELAY_MS);
  return res.data;
}

function isHunterQuotaError(err) {
  const s = err?.response?.status;
  const msg = String(err?.response?.data?.message || "").toLowerCase();
  return s === 401 || s === 402 || msg.includes("quota") || msg.includes("exceeded");
}

async function getApollo(domain) {
  const res = await axios.post(
    `${APOLLO_BASE}/v1/mixed_people/search`,
    {
      api_key: KEY_APOLLO,
      q_organization_domains: [domain],
      page: 1,
      per_page: 10,
    },
    { timeout: 20000 }
  );
  await wait(APOLLO_DELAY_MS);
  return res.data;
}

/* ================= EMAIL QUALITY ================= */

function isLowValue(email) {
  if (!email || !email.includes("@")) return true;
  const local = email.split("@")[0].toLowerCase();
  return [
    "info","support","help","contact","admin","sales","billing",
    "noreply","no-reply","webmaster","hello","team","careers","jobs","press",
  ].includes(local);
}

/* ================= ENRICH DOMAIN (FIXED) ================= */

export async function enrichDomain(domain) {
  const d = String(domain || "").toLowerCase().replace(/^www\./, "").trim();
  const block = shouldBlockDomain(d);

  if (block.blocked) {
    return {
      domain: d,
      emails: [],
      domainInfo: null,
      blocked: true,
      blockReason: block.reason,
      editorial: { hasEditorialSurface: false, signals: [] },
    };
  }

  const emails = new Set();

  /* 🔥 PROSPEO ALWAYS RUNS */
  if (KEY_PROSPEO) {
    try {
      const p = await getProspeo(d);
      p?.emails?.forEach((e) => e?.email && emails.add(e.email.toLowerCase()));
    } catch {}
  }

  /* 🔥 HUNTER */
  let hunterOk = true;
  if (KEY_HUNTER) {
    try {
      const h = await getHunter(d);
      h?.data?.emails?.forEach((e) => {
        const email = e.email || e.value;
        if (email) emails.add(email.toLowerCase());
      });
    } catch (err) {
      if (isHunterQuotaError(err)) hunterOk = false;
    }
  }

  /* 🔥 APOLLO FALLBACK */
  if ((!hunterOk || emails.size < 2) && KEY_APOLLO) {
    try {
      const a = await getApollo(d);
      a?.people?.forEach((p) => p?.email && emails.add(p.email.toLowerCase()));
    } catch {}
  }

  /* 🧠 URLSCAN — METADATA ONLY */
  const domainInfo = await getUrlscan(d);

  return {
    domain: d,
    emails: [...emails].filter((e) => !isLowValue(e)),
    domainInfo,
    blocked: false,
    blockReason: null,
    editorial: { hasEditorialSurface: Boolean(domainInfo), signals: [] },
  };
}
