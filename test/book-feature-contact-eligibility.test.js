import test from "node:test";
import assert from "node:assert/strict";
import { discoverEligibleContacts } from "../services/outreach/bookFeature/contactEligibility.js";

const identity = { status: "verified", officialDomain: "acme.example" };

test("contact discovery requires documented lawful basis, traceable source, exact domain and valid provider result", async () => {
  const withoutAssessment = await discoverEligibleContacts(identity, { assessmentKey: "" });
  assert.equal(withoutAssessment.reason, "lawful_basis_assessment_missing");

  const result = await discoverEligibleContacts(identity, {
    assessmentKey: "private/assessments/acme.json", now: () => new Date("2026-11-27T08:00:00.000Z"),
    searchContacts: async () => ({ status: "complete", provider: "hunter", contacts: [
      { email: "editor@acme.example", role: "Editor", type: "generic", sources: [{ uri: "https://acme.example/contact" }] },
      { email: "person@other.example", role: "Editor", type: "generic", sources: [{ uri: "https://other.example" }] },
      { email: "news@acme.example", role: "News", type: "generic", sources: [] },
    ] }),
    validateEmails: async () => new Map([["editor@acme.example", { status: "valid" }]]),
  });
  assert.equal(result.status, "eligible_contacts_found");
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].email, "editor@acme.example");
  assert.equal(result.contacts[0].recipientType, "role_address");
  assert.equal(result.contacts[0].assessmentKey, "private/assessments/acme.json");
  assert.equal(result.contacts[0].validationExpiresAt, "2026-12-11T08:00:00.000Z");
});

test("named contacts and unknown validation fail closed by default", async () => {
  const result = await discoverEligibleContacts(identity, {
    assessmentKey: "private/assessment.json",
    searchContacts: async () => ({ status: "complete", provider: "hunter", contacts: [
      { email: "jane@acme.example", firstName: "Jane", role: "Editor", type: "personal",
        sources: [{ uri: "https://acme.example/team" }] },
      { email: "editor@acme.example", role: "Editor", type: "generic",
        sources: [{ uri: "https://acme.example/contact" }] },
    ] }),
    validateEmails: async () => new Map([["editor@acme.example", { status: "unknown" }]]),
  });
  assert.equal(result.status, "complete_zero");
  assert.equal(result.reason, "validation_failed_closed");
  assert.deepEqual(result.contacts, []);
});
