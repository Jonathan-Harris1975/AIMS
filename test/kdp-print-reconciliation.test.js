import test from "node:test";
import assert from "node:assert/strict";
import { classifyKdpPrintOutcome, resolveInterruptedPrintTitle,
  reconcileInterruptedPrintJobs } from "../services/kdp/printReconciliation.js";
import { existingPrintMatches } from "../services/kdp/printProduction.js";
import { requiredPrintOptionNames } from "../services/kdp/engine/kdpContentUpdate.ts";

const book = { ebookId: 7, title: "The Artificial Intelligence Revolution" };
const shelf = {
  pagesScanned: 0, refs: [
    { titleId: "AB0123456789", format: "kindle", asin: "B012345678" },
    { titleId: "AC0123456789", format: "paperback", title: book.title },
    { titleId: "AD0123456789", format: "hardcover", title: book.title },
  ],
};
const job = (changes = {}) => ({
  ebookId: 7, format: "paperback", state: "uncertain", titleId: null,
  updatedAt: "2026-11-14 20:00:00", isbn: null, ...changes,
});
const remote = (changes = {}) => ({
  title: book.title, isbn: "9781234567897", publishingStatus: "In Review", ...changes,
});

test("KDP reports Bookshelf snapshots need no HTML page scans", () => {
  assert.equal(existingPrintMatches(shelf, book, "paperback").length, 1);
  assert.throws(() => existingPrintMatches({ ...shelf, pagesScanned: -1 }, book, "paperback"), /inventory/);
  assert.throws(() => existingPrintMatches({ ...shelf, refs: [{ format: "paperback" }] }, book, "paperback"), /inventory/);
});

test("remote status classification is deliberately conservative", () => {
  assert.equal(classifyKdpPrintOutcome("In Review"), "submitted");
  assert.equal(classifyKdpPrintOutcome("Published"), "submitted");
  assert.equal(classifyKdpPrintOutcome("publishing"), "submitted");
  assert.equal(classifyKdpPrintOutcome("Draft"), "draft");
  assert.equal(classifyKdpPrintOutcome("Unable to verify"), "unresolved");
  assert.equal(classifyKdpPrintOutcome("Rejected"), "unresolved");
});

test("a lost draft ID is resolved only against a unique signed-in title+format pair", () => {
  assert.deepEqual(resolveInterruptedPrintTitle(job(), book, shelf),
    { status: "matched", titleId: "AC0123456789" });
  assert.equal(resolveInterruptedPrintTitle(job({ titleId: "BAD123456789" }), book, shelf).status,
    "known_title_identity_conflict");
  assert.equal(resolveInterruptedPrintTitle(job(), book, { refs: [shelf.refs[0]] }).status,
    "creation_outcome_unverifiable");
  assert.equal(resolveInterruptedPrintTitle(job(), book,
    { refs: [shelf.refs[1], shelf.refs[1]] }).status, "ambiguous_matching_titles");
});

test("interrupted KDP submission is reconciled to submitted without a second Publish click", async () => {
  const writes = [];
  const output = await reconcileInterruptedPrintJobs([book], shelf, {
    list: async () => [job()],
    read: async (titleId, format) => {
      assert.equal(titleId, "AC0123456789");
      assert.equal(format, "paperback");
      return remote();
    },
    save: async (...args) => { writes.push(["save",...args]); },
    write: async (...args) => { writes.push(["edition",...args]); },
  });
  assert.equal(output.recovered, 1);
  assert.equal(output.pending, 0);
  assert.equal(output.results[0].status, "submission_reconciled");
  assert.equal(writes[0][3].state, "submitted");
  assert.equal(writes[0][3].titleId, "AC0123456789");
  assert.deepEqual(writes[1], ["edition",7,"paperback","submitted","9781234567897"]);
});

test("KDP draft is resumed only after the 36-hour remote-grace period", async () => {
  const writes = [];
  const options = {
    list: async () => [job()],
    read: async () => remote({ publishingStatus:"Draft", isbn:"" }),
    save: async (...args) => { writes.push(args); },
    write: async () => {},
  };
  let result = await reconcileInterruptedPrintJobs([book], shelf,
    { ...options, now: () => new Date("2026-11-15T19:00:00Z") });
  assert.equal(result.results[0].status, "awaiting_safe_draft_recheck");
  assert.equal(writes.length, 0);
  result = await reconcileInterruptedPrintJobs([book], shelf,
    { ...options, now: () => new Date("2026-11-17T12:00:00Z") });
  assert.equal(result.results[0].status, "saved_draft_recovered");
  assert.equal(writes[0][2].state, "draft");
});

test("unverified print identity or contradictory ISBN never clears uncertain state", async () => {
  let mutations = 0;
  const outcome = await reconcileInterruptedPrintJobs([book], shelf, {
    list: async () => [job({ isbn:"9781111111111" })],
    read: async () => remote(),
    save: async () => { mutations++; },
    write: async () => { mutations++; },
  });
  assert.equal(outcome.pending, 1);
  assert.equal(outcome.results[0].status, "remote_identity_or_isbn_unverified");
  assert.equal(mutations, 0);
});

test("NO-AI print books do not require non-existent AI text/image tool selections", () => {
  const no = requiredPrintOptionNames({ containsAiContent: false });
  assert.ok(no.has("containsAiContent"));
  assert.ok(!no.has("aiTextAmount"));
  assert.ok(!no.has("aiTextTool"));
  const yes = requiredPrintOptionNames({
    containsAiContent: true, aiTextAmount: "some", aiImagesAmount: "none",
  });
  assert.ok(yes.has("aiTextAmount"));
  assert.ok(yes.has("aiTextTool"));
  assert.ok(!yes.has("aiImagesTool"));
});
