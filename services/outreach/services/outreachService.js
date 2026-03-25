import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { appendLeadRows } from "./sheetService.js";

export async function runKeyword(keyword) {
  const result = await serpOutreach(keyword);

  const sourceRows =
    Array.isArray(result?.acceptedDomains) && result.acceptedDomains.length
      ? result.acceptedDomains.map((entry) => ({
          domain: entry?.domain,
          da: entry?.authority?.totalScore ?? entry?.da ?? 0,
          serpPosition: entry?.position ?? entry?.serpPosition ?? null,
          email: entry?.emails?.[0]?.email ?? entry?.email ?? null,
          emailScore:
            entry?.emails?.[0]?.validation?.score ??
            entry?.emailScore ??
            0,
        }))
      : Array.isArray(result?.domains)
      ? result.domains.map((entry) => ({
          domain: entry?.domain,
          da: entry?.authority?.totalScore ?? entry?.da ?? 0,
          serpPosition: entry?.position ?? entry?.serpPosition ?? null,
          email: entry?.emails?.[0]?.email ?? entry?.email ?? null,
          emailScore:
            entry?.emails?.[0]?.validation?.score ??
            entry?.emailScore ??
            0,
        }))
      : [];

  const good = extractGoodLeads(sourceRows, keyword);

  if (good.length) {
    const rows = good.map((r) => [
      r.timestamp,
      r.keyword,
      r.domain,
      r.da,
      r.serpPosition ?? r.serpPos ?? null,
      r.email,
      r.emailScore,
      r.leadScore,
    ]);
    await appendLeadRows(rows);
  }

  return {
    keyword,
    savedLeads: good.length,
    totalDomains: Array.isArray(result?.domains) ? result.domains.length : 0,
  };
}
