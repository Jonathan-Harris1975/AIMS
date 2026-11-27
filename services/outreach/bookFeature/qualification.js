import { scoreOpportunity } from "./core.js";

const VERSION = "book-feature-qualification-v1";

function bounded(value, maximum) {
  return Math.max(0, Math.min(maximum, Math.round(Number(value) || 0)));
}

export function qualifyVerifiedOrganisations(entityAnalysis, identityAnalysis) {
  const entities = new Map((entityAnalysis?.entities || []).map((item) => [item.id, item]));
  return (identityAnalysis?.organisations || []).map((identity) => {
    const entity = entities.get(identity.candidateId);
    const occurrenceCount = Array.isArray(entity?.occurrences) ? entity.occurrences.length : 0;
    const components = {
      depth: bounded(occurrenceCount * 8, 25),
      positiveContext: entity?.sentiment === "positive" ? 20 : entity?.sentiment === "neutral" ? 10 : 0,
      mutualBenefit: entity?.mentionType === "recommended" ? 16 : entity?.mentionType === "featured" ? 13 : 6,
      currentRelevance: identity.status === "verified" ? 15 : 0,
      audienceAlignment: ["company", "product", "research_body", "association"].includes(entity?.entityType) ? 10 : 0,
      relationshipPotential: identity.status === "verified" ? 8 : 0,
    };
    const gates = {
      evidence: occurrenceCount > 0,
      identity: identity.status === "verified",
      contact: false,
      lawfulBasis: false,
      suppression: false,
      duplicate: false,
      qa: false,
      campaign: true,
      authorisation: false,
      enhancedValidation: false,
    };
    const scored = scoreOpportunity(components, gates);
    return { candidateId: identity.candidateId, name: identity.name, identity, entity,
      components, gates, ...scored, qualificationVersion: VERSION,
      state: identity.status === "verified" ? "validated" : "blocked",
      reason: identity.status === "verified" ? "contact_and_communications_gates_pending" : identity.reason };
  });
}

export const bookFeatureQualificationVersion = VERSION;
