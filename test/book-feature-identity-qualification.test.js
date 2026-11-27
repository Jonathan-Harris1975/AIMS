import test from "node:test";
import assert from "node:assert/strict";
import { verifyOrganisationIdentities } from "../services/outreach/bookFeature/organizationIdentity.js";
import { qualifyVerifiedOrganisations } from "../services/outreach/bookFeature/qualification.js";

const research = (sources) => ({ sources: [{ id: "candidate-1", name: "Acme Systems",
  status: "source_leads_found_unverified", sources }] });

test("identity verification requires fetched name evidence and independent corroboration", async () => {
  const pages = new Map([
    ["https://acme.example/about", { canonicalUrl: "https://acme.example/about",
      text: "About us. Acme Systems is our company and builds useful automation products. Contact us." }],
    ["https://industry.example/acme", { canonicalUrl: "https://industry.example/acme",
      text: "Acme Systems company profile. Official website acme.example." }],
  ]);
  const result = await verifyOrganisationIdentities(research([
    { url: "https://acme.example/about", title: "Acme Systems — About us" },
    { url: "https://industry.example/acme", title: "Acme Systems profile" },
  ]), { now: () => new Date("2026-11-27T08:00:00.000Z"), fetchPage: async (url) => pages.get(url) });
  assert.equal(result.verified, 1);
  assert.equal(result.organisations[0].officialDomain, "acme.example");
  assert.equal(result.organisations[0].evidence.length, 2);
  assert.match(result.organisations[0].evidence[0].contentHash, /^[a-f0-9]{64}$/);
});

test("identity verification fails closed for ambiguity, missing corroboration and fetch failures", async () => {
  const single = await verifyOrganisationIdentities(research([
    { url: "https://acme.example/about", title: "Acme Systems" },
  ]), { fetchPage: async () => ({ canonicalUrl: "https://acme.example/about",
    text: "About us. Acme Systems is our company. Contact us." }) });
  assert.equal(single.organisations[0].status, "unverified");
  assert.equal(single.organisations[0].reason, "independent_corroboration_missing");

  const failed = await verifyOrganisationIdentities(research([
    { url: "https://acme.example/about", title: "Acme Systems" },
  ]), { fetchPage: async () => { throw new Error("credentials leaked here"); } });
  assert.equal(failed.organisations[0].reason, "official_identity_not_established");
  assert.equal(failed.organisations[0].evidence[0].reason, "source_fetch_failed");
});

test("qualification persists deterministic components but mandatory contact gates remain closed", () => {
  const entity = { id: "candidate-1", name: "Acme Systems", entityType: "company", sentiment: "positive",
    mentionType: "recommended", occurrences: [{ pdfPage: 2 }, { pdfPage: 8 }] };
  const qualified = qualifyVerifiedOrganisations({ entities: [entity] }, { organisations: [{ candidateId: "candidate-1",
    name: "Acme Systems", status: "verified", officialDomain: "acme.example", evidence: [] }] })[0];
  assert.equal(qualified.score, 85);
  assert.equal(qualified.state, "validated");
  assert.equal(qualified.eligible, false);
  assert.ok(qualified.failedGates.includes("contact"));
  assert.ok(qualified.failedGates.includes("qa"));
  assert.equal(qualified.gates.identity, true);
});
