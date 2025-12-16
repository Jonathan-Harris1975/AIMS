import { serpOutreach } from "./serpOutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { appendLeadRows } from "./sheetService.js";

export async function runKeyword(keyword) {
  const result = await serpOutreach(keyword);
  const good = extractGoodLeads(result, keyword);

  if (good.length) {
    await appendLeadRows(good.map(r => [
      r.timestamp,r.keyword,r.domain,r.da,
      r.serpPosition,r.email,r.emailScore,r.leadScore
    ]));
  }

  return { keyword, savedLeads: good.length };
}
