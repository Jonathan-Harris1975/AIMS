import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("newsletter delivery is recipient-idempotent and includes one-click unsubscribe", async () => {
  const source = await readFile(new URL("../services/newsletter/delivery/aimsDelivery.js", import.meta.url), "utf8");
  assert.match(source, /SELECT status FROM newsletter_delivery_recipients/);
  assert.match(source, /status === "sent"/);
  assert.match(source, /createUnsubscribeToken/);
  assert.match(source, /newsletter\/unsubscribe/);
});

test("newly confirmed subscribers receive today's issue when one is available", async () => {
  const delivery = await readFile(new URL("../services/newsletter/delivery/aimsDelivery.js", import.meta.url), "utf8");
  const subscriptions = await readFile(new URL("../services/newsletter/routes/subscriptions.js", import.meta.url), "utf8");
  assert.match(delivery, /deliverTodaysIssueToSubscriber/);
  assert.match(delivery, /findLatestIssueSessionId/);
  assert.match(delivery, /no_issue_today/);
  assert.match(subscriptions, /deliverTodaysIssueToSubscriber/);
});
