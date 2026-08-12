import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { saveLeadBatch } from "./leadStore.js";
import { resolveOutreachThresholds } from "../config.js";

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

  const thresholds = resolveOutreachThresholds();
  const storage = good.length
    ? await saveLeadBatch({ keyword, leads: good, thresholds })
    : null;

  return {
    keyword,
    savedLeads: good.length,
    totalDomains: Array.isArray(result?.domains) ? result.domains.length : 0,
    thresholds,
    storage,
  };
}
