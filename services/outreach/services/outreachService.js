import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads, emailValidationScore } from "../utils/filters.js";
import { saveLeadBatch } from "./leadStore.js";
import { resolveOutreachThresholds } from "../config.js";

function bestEmail(entry) {
  const candidates = (entry?.emails || []).map((item) => {
    const local = String(item?.email || "").split("@")[0].toLowerCase();
    const generic = /^(editor|editorial|content|contribute|contributors|submissions|submit|news|press|media|contact|hello|info|marketing|partnerships?|communications|comms)([._-]|$)/.test(local);
    return { ...item, score: emailValidationScore(item.validation) + (generic ? 0.25 : 0) };
  }).sort((a,b) => b.score - a.score);
  return candidates[0] || null;
}

export async function runKeyword(keyword) {
  const result = await serpOutreach(keyword);
  const collection = Array.isArray(result?.acceptedDomains) && result.acceptedDomains.length ? result.acceptedDomains : (result?.domains || []);
  const sourceRows = collection.map((entry) => {
    const chosen = bestEmail(entry);
    return {
      domain: entry?.domain, da: entry?.authority?.totalScore ?? entry?.da ?? 0,
      serpPosition: entry?.position ?? entry?.authority?.serpPosition ?? entry?.serpPosition ?? null,
      email: chosen?.email ?? null, emailScore: emailValidationScore(chosen?.validation), validation: chosen?.validation || {},
      contact: chosen?.hunter || null, sourceUrl: entry?.sourceUrl || null, sourceTitle: entry?.sourceTitle || null,
      sourceSnippet: entry?.sourceSnippet || null, editorialSurface: Boolean(entry?.authority?.editorialSurface),
    };
  });
  const good = extractGoodLeads(sourceRows, keyword);
  const thresholds = resolveOutreachThresholds();
  const storage = good.length ? await saveLeadBatch({ keyword, leads: good, thresholds }) : null;
  let automation = null;
  if (good.length && String(process.env.OUTREACH_AUTOMATION_ENABLED || "true").toLowerCase() !== "false") {
    const { getCommsHubContext } = await import("../../comms-hub/runtime.js");
    automation = await getCommsHubContext().outreachAutomationService.automateLeads(good, { keyword });
  }
  return { keyword, savedLeads: good.length, totalDomains: Array.isArray(result?.domains) ? result.domains.length : 0, thresholds, storage, automation };
}
