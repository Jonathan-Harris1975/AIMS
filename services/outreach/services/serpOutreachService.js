import { serpLookup, outreachScan } from "./outreachCore.js";

const BLOCK = new Set([
  "youtube.com","amazon.com","facebook.com","instagram.com",
  "reddit.com","linkedin.com","x.com","twitter.com"
]);

export async function serpOutreach(keyword) {
  const serp = await serpLookup(keyword);
  const organic = serp?.organic_results || [];

  const leads = [];

  for (let i = 0; i < organic.length; i++) {
    const link = organic[i]?.link;
    if (!link) continue;

    const host = new URL(link).hostname.replace(/^www\./, "");
    if (BLOCK.has(host)) continue;

    const scan = await outreachScan(host);
    const da = scan?.da?.da || 0;

    let best = 0;
    scan.emails.forEach(e => {
      if (e.valid && e.score > best) best = e.score;
    });

    const score =
      (da / 100) * 50 +
      (i < 10 ? (10 - i) * 3 : 0) +
      best * 20;

    leads.push({
      domain: host,
      serpPosition: i + 1,
      da: scan.da,
      emails: scan.emails,
      score: Math.round(score)
    });
  }

  leads.sort((a, b) => b.score - a.score);
  return { keyword, totalDomains: leads.length, leads };
}
