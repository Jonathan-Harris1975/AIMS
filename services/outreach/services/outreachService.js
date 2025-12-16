import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { appendLeadRows } from "./sheetService.js";

export async function runKeyword(keyword) {
  const result = await serpOutreach(keyword);
  const good = extractGoodLeads(result, keyword);

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

  return { keyword, savedLeads: good.length, totalDomains: result.totalDomains };
}
