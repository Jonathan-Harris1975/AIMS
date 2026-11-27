import axios from "axios";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { batchValidateEmails } from "../services/zeroBounceBatch.js";

const ROLE_LOCAL_PARTS = new Set(["editor", "editorial", "content", "press", "media", "partnerships", "communications", "comms"]);
const MAX_CONTACTS = 3;
const VALIDATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function domainOf(email) { return String(email || "").trim().toLowerCase().split("@")[1] || ""; }
function localPart(email) { return String(email || "").trim().toLowerCase().split("@")[0] || ""; }
function isTraceableSource(url, officialDomain) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
    [officialDomain, `www.${officialDomain}`].includes(parsed.hostname.toLowerCase()); }
  catch { return false; }
}

async function hunterContacts(domain, { apiKey = process.env.API_HUNTER_KEY || process.env.HUNTER_API_KEY } = {}) {
  if (!apiKey) return { status: "unavailable", reason: "contact_provider_not_configured", contacts: [] };
  try {
    const response = await axios.get("https://api.hunter.io/v2/domain-search", {
      params: { domain, api_key: apiKey, limit: 10 }, timeout: 15_000,
    });
    return { status: "complete", provider: "hunter", contacts: (response.data?.data?.emails || []).map((item) => ({
      email: item.email, firstName: item.first_name || null, lastName: item.last_name || null,
      role: item.position || item.department || item.type || "unknown", type: item.type || null,
      confidence: Number(item.confidence || 0), sources: Array.isArray(item.sources) ? item.sources : [],
    })) };
  } catch (error) {
    return { status: "failed", reason: error?.response?.status === 429 ? "contact_provider_rate_limited" : "contact_provider_failed", contacts: [] };
  }
}

export async function checkCurrentContactAssessment({ domain, email, recipientType, campaign, assessmentKey, now = new Date() },
  { readAssessment = async (key) => JSON.parse(await getObjectAsText("kdp", key)) } = {}) {
  if (!domain || !email || !assessmentKey || !["role_address","named_person"].includes(recipientType)) return false;
  try {
    const record = await readAssessment(assessmentKey);
    const scoped = record?.organisations?.[domain];
    const approval = scoped?.[campaign] || scoped || record;
    return approval?.officialDomain === domain && approval.campaign === campaign &&
      approval.channel === "email" && approval.jurisdiction === "GB" && approval.subscriberType === "corporate" &&
      approval.lawfulBasis === "legitimate_interests_documented" && approval.approved === true &&
      typeof approval.approvedBy === "string" && Boolean(approval.approvedBy.trim()) &&
      Date.parse(approval.assessedAt || "") <= now.getTime() && Date.parse(approval.expiresAt || "") > now.getTime() &&
      ["confirmed","not_required"].includes(approval.consentStatus) &&
      Array.isArray(approval.allowedRecipientTypes) && approval.allowedRecipientTypes.includes(recipientType) &&
      (recipientType === "role_address" || (approval.consentStatus === "confirmed" && Array.isArray(approval.consentedEmails) &&
        approval.consentedEmails.includes(email)));
  } catch { return false; }
}

export async function discoverEligibleContacts(identity, {
  searchContacts = hunterContacts,
  validateEmails = batchValidateEmails,
  assessmentKey = process.env.BOOK_FEATURE_LAWFUL_BASIS_ASSESSMENT_KEY || "",
  allowNamed = process.env.BOOK_FEATURE_ALLOW_NAMED_CONTACTS === "true",
  readAssessment = async (key) => JSON.parse(await getObjectAsText("kdp", key)),
  now = () => new Date(),
} = {}) {
  if (identity?.status !== "verified" || !identity.officialDomain) {
    return { status: "blocked", reason: "organisation_identity_unverified", contacts: [] };
  }
  if (!assessmentKey) return { status: "blocked", reason: "lawful_basis_assessment_missing", contacts: [] };
  let assessment;
  try { assessment = await readAssessment(assessmentKey); }
  catch { return { status: "blocked", reason: "lawful_basis_assessment_unavailable", contacts: [] }; }
  const observed = now().getTime();
  const scoped = assessment?.organisations?.[identity.officialDomain];
  const approval = scoped?.book_feature || scoped || assessment;
  const validAssessment = approval?.officialDomain === identity.officialDomain && approval?.campaign === "book_feature" &&
    approval?.channel === "email" && approval?.jurisdiction === "GB" && approval?.subscriberType === "corporate" &&
    approval?.lawfulBasis === "legitimate_interests_documented" && approval?.approved === true &&
    typeof approval?.approvedBy === "string" && approval.approvedBy.trim() &&
    Date.parse(approval.assessedAt || "") <= observed && Date.parse(approval.expiresAt || "") > observed &&
    ["confirmed","not_required"].includes(approval.consentStatus) && Array.isArray(approval.allowedRecipientTypes);
  if (!validAssessment) return { status: "blocked", reason: "lawful_basis_assessment_invalid_or_expired", contacts: [] };
  const found = await searchContacts(identity.officialDomain);
  if (found?.status !== "complete") return { status: found?.status || "failed", reason: found?.reason || "contact_provider_failed", contacts: [] };
  const candidates = (found.contacts || []).filter((item) => {
    const email = String(item?.email || "").trim().toLowerCase();
    const source = item?.sources?.find((row) => isTraceableSource(row?.uri || row?.url, identity.officialDomain));
    const generic = ROLE_LOCAL_PARTS.has(localPart(email));
    return email && domainOf(email) === identity.officialDomain && source &&
      approval.allowedRecipientTypes.includes(generic ? "role_address" : "named_person") &&
      (generic || (allowNamed && approval.consentStatus === "confirmed" && approval.consentedEmails?.includes(email)));
  }).slice(0, 10);
  if (!candidates.length) return { status: "complete_zero", reason: "no_traceable_policy_eligible_contact", contacts: [] };
  const validation = await validateEmails(candidates.map((item) => String(item.email).toLowerCase()));
  const validatedAt = now();
  const contacts = candidates.map((item) => {
    const email = String(item.email).trim().toLowerCase();
    const result = validation.get(email) || { status: "unknown" };
    const generic = ROLE_LOCAL_PARTS.has(localPart(email));
    const source = item.sources.find((row) => isTraceableSource(row?.uri || row?.url, identity.officialDomain));
    const valid = String(result.status || "").toLowerCase() === "valid";
    return { email, displayName: generic ? null : [item.firstName, item.lastName].filter(Boolean).join(" ") || null,
      role: String(item.role || "unknown").slice(0, 160), recipientType: generic ? "role_address" : "named_person",
      sourceUrl: source.uri || source.url, sourceTitle: String(source.title || "").slice(0, 300) || null,
      provider: found.provider || "contact_provider", validationProvider: "zerobounce", validationResult: valid ? "valid" :
        ["invalid","spamtrap","abuse","do_not_mail"].includes(String(result.status).toLowerCase()) ? "invalid" : "unknown",
      validatedAt: validatedAt.toISOString(), validationExpiresAt: new Date(Math.min(validatedAt.getTime() + VALIDATION_TTL_MS, Date.parse(approval.expiresAt))).toISOString(),
      jurisdiction: approval.jurisdiction, lawfulBasis: approval.lawfulBasis, assessmentKey,
      consentStatus: approval.consentStatus, eligibilityStatus: valid ? "eligible" : "ineligible" };
  }).filter((item) => item.eligibilityStatus === "eligible").slice(0, MAX_CONTACTS);
  return { status: contacts.length ? "eligible_contacts_found" : "complete_zero", reason: contacts.length ? null : "validation_failed_closed",
    contacts, provider: found.provider || "contact_provider" };
}

export const bookFeatureContactLimits = Object.freeze({ maxContacts: MAX_CONTACTS, validationTtlMs: VALIDATION_TTL_MS });
