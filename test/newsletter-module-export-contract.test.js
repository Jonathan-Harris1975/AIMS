import test from "node:test";
import assert from "node:assert/strict";

test("newsletter D1 audience and AIMS delivery exports are available", async () => {
  const audience = await import("../services/newsletter/audience/d1Audience.js");
  const delivery = await import("../services/newsletter/delivery/aimsDelivery.js");
  assert.equal(typeof audience.beginSubscription, "function");
  assert.equal(typeof audience.confirmSubscription, "function");
  assert.equal(typeof audience.unsubscribe, "function");
  assert.equal(typeof delivery.deliverNewsletterIssue, "function");
  assert.equal(typeof delivery.deliverTodaysIssueToSubscriber, "function");
});
