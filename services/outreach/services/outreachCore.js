import axios from "axios";

const KEY_RAPIDAPI = process.env.RAPIDAPI_KEY;
const KEY_URLSCAN = process.env.API_URLSCAN_KEY;
const KEY_PROSPEO = process.env.API_PROSPEO_KEY;
const KEY_HUNTER = process.env.API_HUNTER_KEY;
const KEY_APOLLO = process.env.API_APOLLO_KEY;

const URLSCAN_BASE = "https://urlscan.io/api/v1";
const PROSPEO_BASE = "https://api.prospeo.io";
const HUNTER_BASE = "https://api.hunter.io";
const APOLLO_BASE = "https://api.apollo.io";
const SERP_HOST = "google-search116.p.rapidapi.com";

const HUNTER_DELAY_MS = Number(process.env.HUNTER_DELAY_MS || "500");
const APOLLO_DELAY_MS = Number(process.env.APOLLO_DELAY_MS || "800");
const URLSCAN_DELAY_MS = Number(process.env.URLSCAN_DELAY_MS || "2000");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= DOMAIN QUALITY FILTERS ================= */

// Hard blocklist: domains that never yield quality outreach leads
const HARD_BLOCK_DOMAINS = new Set([
  // comparison/affiliate
  "capterra.com",
  "g2.com",
  "trustpilot.com",
  "softwareadvice.com",
  "getapp.com",
  "sourceforge.net",
  "alternativeto.net",
  "stackshare.io",
  "producthunt.com",
  // UGC/social
  "reddit.com",
  "quora.com",
  "linkedin.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "medium.com",
  "substack.com",
  "slideshare.net",
  // reference
  "wikipedia.org",
  "wikidata.org",
  "britannica.com",
  "investopedia.com",
  // press release syndication
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "einpresswire.com",
  "newswire.com",
  // marketplaces/app stores/dev registries
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "docker.com",
  "hub.docker.com",
  "play.google.com",
  "apps.apple.com",
]);

// Spam-heavy or outreach-useless host suffixes / patterns
const HARD_BLOCK_HOST_PATTERNS = [
  /\.gov(\.|$)/i,
  /\.edu(\.|$)/i,
  /\.ac\.uk(\.|$)/i, // academic tends to be a dead-end for outreach automation
  /(^|\.)github\.io$/i,
  /(^|\.)vercel\.app$/i,
  /(^|\.)netlify\.app$/i,
  /(^|\.)wixsite\.com$/i,
  /(^|\.)sites\.google\.com$/i,
  /(^|\.)webflow\.io$/i,
];

// Junk/spammy TLDs (conditional use is possible, but for your funnel: block)
const HARD_BLOCK_TLDS = new Set([
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "top",
  "click",
  "link",
  "live",
]);

export function shouldBlockDomain(domain) {
  if (!domain || typeof domain !== "string") {
    return { blocked: true, reason: "invalid_domain" };
  }

  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!d || d.includes("..")) return { blocked: true, reason: "invalid_domain" };

  // Exact hard-block domains (also block subdomains of them)
  for (const root of HARD_BLOCK_DOMAINS) {
    if (d === root || d.endsWith(`.${root}`)) {
      return { blocked: true, reason: `hard_block:${root}` };
    }
  }

  // Host patterns
  for (const re of HARD_BLOCK_HOST_PATTERNS) {
    if (re.test(d)) return { blocked: true, reason: "hard_block:host_pattern" };
  }

  // TLD blocks
  const parts = d.split(".");
  const tld = parts[parts.length - 1];
  if (HARD_BLOCK_TLDS.has(tld)) return { blocked: true, reason: `hard_block:tld:${tld}` };

  return { blocked: false, reason: null };
}

function extractUrlscanText(domainInfo) {
  try {
    const results = Array.isArray(domainInfo?.results) ? domainInfo.results : [];
    return results
      .map((r) => {
        const title = r?.page?.title || "";
        const url = r?.page?.url || "";
        return `${title} ${url}`.toLowerCase();
      })
      .join(" ");
  } catch {
    return "";
  }
}

function detectEditorialSignals(domainInfo) {
  const text = extractUrlscanText(domainInfo);
  const hits = [];

  const checks = [
    "blog",
    "blogs",
    "article",
    "articles",
    "news",
    "insights",
    "resources",
    "guides",
    "research",
    "publications",
    "case-studies",
    "case studies",
    "whitepaper",
    "whitepapers",
    "press", // not PR wires; useful for “press page exists”
  ];

  for (const k of checks) {
    if (text.includes(k)) hits.push(k);
  }

  // Fast “surface exists” heuristic
  const hasEditorialSurface =
    text.includes("/blog") ||
    text.includes("/articles") ||
    text.includes("/news") ||
    text.includes("/insights") ||
    text.includes("/resources") ||
    text.includes("/research") ||
    text.includes("/guides") ||
    text.includes("/case-studies") ||
    text.includes("/publications");

  return {
    hasEditorialSurface,
    signals: [...new Set(hits)],
  };
}

/* ================= SERP ================= */
export async function serpLookup(keyword) {
  if (!KEY_RAPIDAPI) {
    throw new Error("RAPIDAPI_KEY missing");
  }

  const res = await axios.get(`https://${SERP_HOST}/`, {
    params: { query: keyword },
    headers: {
      "x-rapidapi-key": KEY_RAPIDAPI,
      "x-rapidapi-host": SERP_HOST,
    },
    timeout: 15000,
  });
  return res.data;
}

/* ================= URLSCAN (NON-FATAL) ================= */
async function getUrlscan(domain) {
  try {
    const res = await axios.get(`${URLSCAN_BASE}/search/`, {
      params: { q: `domain:${domain}` },
      headers: { "API-Key": KEY_URLSCAN },
      timeout: 15000,
    });
    await wait(URLSCAN_DELAY_MS);
    return res.data;
  } catch (err) {
    const code = err?.response?.status;
    if (code === 429) {
      console.log(`⚠️ Urlscan rate-limited for ${domain}`);
    } else {
      console.log(`⚠️ Urlscan failed for ${domain}`);
    }
    return null;
  }
}

/* ================= PROSPEO ================= */
async function getProspeo(domain) {
  const res = await axios.get(`${PROSPEO_BASE}/api/email-finder`, {
    params: { domain },
    headers: { "X-Api-Key": KEY_PROSPEO },
    timeout: 15000,
  });
  return res.data;
}

/* ================= HUNTER ================= */
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

/* ================= APOLLO ================= */
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
  if (typeof email !== "string" || !email.includes("@")) return true;

  const [local, host] = email.toLowerCase().split("@");

  // Bin obvious rubbish
  if (!local || !host) return true;
  if (local.length <= 1) return true;

  // Reject role accounts
  const role = new Set([
    "info",
    "support",
    "help",
    "contact",
    "admin",
    "sales",
    "billing",
    "noreply",
    "no-reply",
    "webmaster",
    "hello",
    "team",
    "careers",
    "jobs",
    "press",
  ]);
  if (role.has(local)) return true;

  return false;
}

/* ================= ENRICH DOMAIN ================= */
export async function enrichDomain(domain) {
  const d = String(domain || "").toLowerCase().replace(/^www\./, "").trim();
  const block = shouldBlockDomain(d);

  // Hard block early: do not burn enrichment budget
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

  try {
    const domainInfo = KEY_URLSCAN ? await getUrlscan(d) : null;
    const editorial = detectEditorialSignals(domainInfo);

    const emails = new Set();

    // Prospeo: best for generic capture when editorial surface exists OR urlscan unavailable
    if (KEY_PROSPEO && (editorial.hasEditorialSurface || !domainInfo)) {
      try {
        const p = await getProspeo(d);
        p?.emails?.forEach((e) => {
          if (e?.email?.includes("@")) emails.add(e.email.toLowerCase());
        });
      } catch {}
    }

    // Hunter: good quality, but handle quota cleanly
    let hunterOk = true;
    if (KEY_HUNTER) {
      try {
        const h = await getHunter(d);
        h?.data?.emails?.forEach((e) => {
          const email = e.email || e.value;
          if (email?.includes("@")) emails.add(email.toLowerCase());
        });
      } catch (err) {
        if (isHunterQuotaError(err)) {
          console.log("⚠️ Hunter quota exhausted — switching to Apollo");
          hunterOk = false;
        }
      }
    }

    // Apollo fallback when Hunter is exhausted OR too few emails
    if ((!hunterOk || emails.size < 2) && KEY_APOLLO) {
      try {
        const a = await getApollo(d);
        a?.people?.forEach((p) => {
          if (p?.email?.includes("@")) emails.add(p.email.toLowerCase());
        });
      } catch {}
    }

    return {
      domain: d,
      emails: [...emails].filter((e) => !isLowValue(e)),
      domainInfo, // may be null (non-fatal)
      blocked: false,
      blockReason: null,
      editorial,
    };
  } catch (err) {
    console.log(`❌ enrichDomain hard-failed for ${d}: ${err.message}`);
    return {
      domain: d,
      emails: [],
      domainInfo: null,
      blocked: false,
      blockReason: null,
      editorial: { hasEditorialSurface: false, signals: [] },
    };
  }
    }
