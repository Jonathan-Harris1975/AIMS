import test from "node:test";
import assert from "node:assert/strict";

test("newsletter route dependencies are exported by the Brevo campaign module", async () => {
  const campaign = await import("../services/newsletter/brevo/campaign.js");
  assert.equal(typeof campaign.deliverNewsletterIssue, "function");
  assert.equal(typeof campaign.getNewsletterDeliveryReadiness, "function");
  assert.equal(typeof campaign.getCampaignStatus, "function");
});
