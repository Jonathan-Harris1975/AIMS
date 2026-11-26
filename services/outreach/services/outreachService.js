import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads, emailValidationScore } from "../utils/filters.js";
import { resolveOutreachThresholds } from "../config.js";
import { scoreOpportunity } from "../utils/qualification.js";

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "yahoo.com", "yahoo.co.uk", "aol.com", "proton.me", "protonmail.com"]);
const EXCLUDED_LOCAL_PARTS = /^(?:no-?reply|donotreply|do-?not-?reply|sales|support|billing|accounts|recruitment|careers?|jobs?|hr|webmaster|admin)$/i;
const ROLE_LOCAL_PARTS = /^(?:editor|editorial|content|contribute|contributors?|guestposts?|submissions?|submit|news|press|media|contact|hello|info|communications?|comms)$/i;

function domainOfEmail(email) {
  return String(email || "").trim().toLowerCase().split("@")[1] || "";
}
function cleanDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^www\./, "");
}
/** Choose a recipient only after editorial evidence is present. */
export function bestEmail(entry, env = process.env) {
  const domain = cleanDomain(entry?.domain);
  const evidence = entry?.editorialEvidence || {};
  const allowNamed = String(env.OUTREACH_ALLOW_NAMED_BUSINESS_CONTACTS || "false").toLowerCase() === "true";
  const allowCatchAll = String(env.OUTREACH_ALLOW_CATCH_ALL || "false").toLowerCase() === "true";
  const candidates = (entry?.emails || []).map((item) => {
    const email = String(item?.email || "").trim().toLowerCase();
    const local = email.split("@")[0] || "";
    const emailDomain = domainOfEmail(email);
    const validationStatus = String(item?.validation?.status || "unknown").toLowerCase();
    const role = ROLE_LOCAL_PARTS.test(local) || String(item?.hunter?.type || "").toLowerCase() === "generic";
    const editorialLocal = /^(?:editor|editorial|content|contribute|contributors?|guestposts?|submissions?|submit)$/.test(local);
    const named = !role && Boolean(item?.hunter?.firstName || item?.hunter?.lastName);
    const editorialContact = Boolean(evidence.editorialRoute) && (
      role || /editor|content|submission|contribut|writer|media|press/i.test(
        `${item?.hunter?.position || ""} ${item?.hunter?.department || ""}`
      )
    );
    const eligible = Boolean(email && email.includes("@") && emailDomain === domain && !FREE_MAIL.has(emailDomain)
      && !EXCLUDED_LOCAL_PARTS.test(local)
      && (validationStatus === "valid" || (allowCatchAll && ["catch-all", "catch_all"].includes(validationStatus)))
      && ((role && editorialContact) || (allowNamed && named && editorialContact)));
    const score = (validationStatus === "valid" ? 100 : 65)
      + (editorialContact ? 20 : 0) + (editorialLocal ? 20 : 0) + (role ? 5 : 0)
      + (named ? 5 : 0) + Math.min(10, Number(item?.hunter?.confidence || 0) / 10);
    return { ...item, email, score, eligibility: { eligible, editorialContact, role, named, recipientType: role ? "role" : "named_business", validationStatus } };
  }).filter((item) => item.eligibility.eligible);
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}
export async function runKeyword(keyword) {
  const result = await serpOutreach(keyword);
  const collection = Array.isArray(result?.acceptedDomains) ? result.acceptedDomains : [];
  const seenDomains = new Set();
  const sourceRows = [];
  for (const entry of collection) {
    const domain = cleanDomain(entry?.domain);
    if (!domain || seenDomains.has(domain)) continue;
    const chosen = bestEmail(entry);
    if (!chosen) continue;
    const qualification = scoreOpportunity({
      keyword,
      evidence: entry.editorialEvidence,
      contact: chosen.eligibility,
      validation: chosen.validation,
      authority: entry.authority,
    });
    sourceRows.push({
      domain,
      da: entry?.authority?.totalScore ?? 0,
      serpPosition: entry?.authority?.serpPosition ?? null,
      email: chosen.email,
      emailScore: emailValidationScore(chosen.validation),
      validation: chosen.validation || {},
      contact: chosen.hunter || null,
      contactType: chosen.eligibility.recipientType,
      sourceUrl: entry.sourceUrl || null,
      sourceTitle: entry.sourceTitle || null,
      sourceSnippet: entry.sourceSnippet || null,
      editorialSurface: Boolean(entry?.authority?.editorialSurface),
      editorialEvidence: entry.editorialEvidence,
      opportunityScore: qualification.total,
      qualification,
    });
    seenDomains.add(domain);
  }
  const good = extractGoodLeads(sourceRows, keyword);
  const thresholds = resolveOutreachThresholds();
  const storage = good.length ? await (await import("./leadStore.js")).saveLeadBatch({ keyword, leads: good, thresholds }) : null;
  let automation = null;
  if (good.length && String(process.env.OUTREACH_AUTOMATION_ENABLED || "true").toLowerCase() !== "false") {
    const { getCommsHubContext } = await import("../../comms-hub/runtime.js");
    automation = await getCommsHubContext().outreachAutomationService.automateLeads(good, { keyword });
  }
  return {
    keyword,
    savedLeads: good.length,
    totalDomains: Array.isArray(result?.domains) ? result.domains.length : 0,
    thresholds,
    storage,
    automation,
    qualificationPolicy: "outreach-qualification-v1",
  };
}
