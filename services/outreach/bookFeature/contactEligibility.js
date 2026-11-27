import axios from "axios";
import { batchValidateEmails } from "../services/zeroBounceBatch.js";

const ROLE_LOCAL_PARTS = new Set(["editor", "editorial", "content", "press", "media", "partnerships", "communications", "comms"]);
const MAX_CONTACTS = 3;
const VALIDATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function domainOf(email) { return String(email || "").trim().toLowerCase().split("@")[1] || ""; }
function localPart(email) { return String(email || "").trim().toLowerCase().split("@")[0] || ""; }
function isTraceableSource(url) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password; }
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

export async function discoverEligibleContacts(identity, {
  searchContacts = hunterContacts,
  validateEmails = batchValidateEmails,
  assessmentKey = process.env.BOOK_FEATURE_LAWFUL_BASIS_ASSESSMENT_KEY || "",
  allowNamed = process.env.BOOK_FEATURE_ALLOW_NAMED_CONTACTS === "true",
  now = () => new Date(),
} = {}) {
  if (identity?.status !== "verified" || !identity.officialDomain) {
    return { status: "blocked", reason: "organisation_identity_unverified", contacts: [] };
  }
  if (!assessmentKey) return { status: "blocked", reason: "lawful_basis_assessment_missing", contacts: [] };
  const found = await searchContacts(identity.officialDomain);
  if (found?.status !== "complete") return { status: found?.status || "failed", reason: found?.reason || "contact_provider_failed", contacts: [] };
  const candidates = (found.contacts || []).filter((item) => {
    const email = String(item?.email || "").trim().toLowerCase();
    const source = item?.sources?.find((row) => isTraceableSource(row?.uri || row?.url));
    const generic = ROLE_LOCAL_PARTS.has(localPart(email)) || String(item?.type || "").toLowerCase() === "generic";
    return email && domainOf(email) === identity.officialDomain && source && (generic || allowNamed);
  }).slice(0, 10);
  if (!candidates.length) return { status: "complete_zero", reason: "no_traceable_policy_eligible_contact", contacts: [] };
  const validation = await validateEmails(candidates.map((item) => String(item.email).toLowerCase()));
  const validatedAt = now();
  const contacts = candidates.map((item) => {
    const email = String(item.email).trim().toLowerCase();
    const result = validation.get(email) || { status: "unknown" };
    const generic = ROLE_LOCAL_PARTS.has(localPart(email)) || String(item.type || "").toLowerCase() === "generic";
    const source = item.sources.find((row) => isTraceableSource(row?.uri || row?.url));
    const valid = String(result.status || "").toLowerCase() === "valid";
    return { email, displayName: generic ? null : [item.firstName, item.lastName].filter(Boolean).join(" ") || null,
      role: String(item.role || "unknown").slice(0, 160), recipientType: generic ? "role_address" : "named_person",
      sourceUrl: source.uri || source.url, sourceTitle: String(source.title || "").slice(0, 300) || null,
      provider: found.provider || "contact_provider", validationProvider: "zerobounce", validationResult: valid ? "valid" :
        ["invalid","spamtrap","abuse","do_not_mail"].includes(String(result.status).toLowerCase()) ? "invalid" : "unknown",
      validatedAt: validatedAt.toISOString(), validationExpiresAt: new Date(validatedAt.getTime() + VALIDATION_TTL_MS).toISOString(),
      jurisdiction: "GB", lawfulBasis: "legitimate_interests_documented", assessmentKey,
      consentStatus: "not_required", eligibilityStatus: valid ? "eligible" : "ineligible" };
  }).filter((item) => item.eligibilityStatus === "eligible").slice(0, MAX_CONTACTS);
  return { status: contacts.length ? "eligible_contacts_found" : "complete_zero", reason: contacts.length ? null : "validation_failed_closed",
    contacts, provider: found.provider || "contact_provider" };
}

export const bookFeatureContactLimits = Object.freeze({ maxContacts: MAX_CONTACTS, validationTtlMs: VALIDATION_TTL_MS });
