import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("newsletter has no Brevo runtime adapter and uses AIMS D1 plus one.com delivery", async () => {
  const delivery = await readFile(new URL("../services/newsletter/delivery/aimsDelivery.js", import.meta.url), "utf8");
  const audience = await readFile(new URL("../services/newsletter/audience/d1Audience.js", import.meta.url), "utf8");
  assert.match(delivery, /OneComMailClient/);
  assert.match(delivery, /newsletter_delivery_recipients/);
  assert.match(audience, /newsletter_subscribers/);
  assert.match(audience, /newsletter_suppressions/);
  assert.doesNotMatch(delivery, /Brevo|api\.brevo/i);
});
