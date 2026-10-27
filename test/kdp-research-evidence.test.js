import test from "node:test";
import assert from "node:assert/strict";
import { captureCompetitorEvidence } from "../services/kdp/researchEvidence.js";

test("captures identity-checked pages but does not mark them as comparable or non-promotional", async () => {
  const research = { competitors: { US: [{ asin: "B012345678" }], UK: [] } };
  const result = await captureCompetitorEvidence(research, { audit: async () => ({ listings: [{
    asin: "B012345678", url: "https://www.amazon.com/dp/B012345678",
    publicListing: { status: "captured", checkedAt: "2026-10-27T12:00:00Z", data: { title: "Book", price: "$5.99", priceSource: "kindle_price_element" } },
  }] }) });
  assert.equal(result.markets.US.listings[0].price, "$5.99");
  assert.equal(result.markets.US.listings[0].comparability, "unverified");
  assert.equal(result.markets.US.listings[0].promotionalStatus, "unknown");
  assert.equal(result.markets.UK.status, "no_candidates");
});

test("stops making marketplace requests when Amazon blocks access", async () => {
  const research = { competitors: { US: [{ asin: "B012345678" }], UK: [{ asin: "B012345679" }] } };
  let calls = 0;
  const result = await captureCompetitorEvidence(research, { audit: async () => {
    calls++;
    return { listings: [{ asin: "B012345678", publicListing: { status: "blocked", checkedAt: null, data: null } }] };
  } });
  assert.equal(calls, 1);
  assert.equal(result.markets.UK.status, "skipped_after_block");
});
