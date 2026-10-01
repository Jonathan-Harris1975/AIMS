import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("newsletter audience requires verified active consent and honours suppression", async () => {
  const source = await readFile(new URL("../services/newsletter/audience/d1Audience.js", import.meta.url), "utf8");
  assert.match(source, /s\.status='active'/);
  assert.match(source, /ns\.status='active'/);
  assert.match(source, /ns\.verified_at IS NOT NULL/);
  assert.match(source, /sup\.email_hash IS NULL/);
});

test("newsletter consent and suppression records are not routine housekeeping purge targets", async () => {
  const housekeeping = await readFile(new URL("../services/comms-hub/repositories/commsHousekeepingRepository.js", import.meta.url), "utf8");
  assert.match(housekeeping, /newsletterVerificationTokensDeleted/);
  assert.doesNotMatch(housekeeping, /DELETE FROM newsletter_consent_events/);
  assert.doesNotMatch(housekeeping, /DELETE FROM newsletter_suppressions/);
  assert.doesNotMatch(housekeeping, /DELETE FROM newsletter_subscribers/);
});
