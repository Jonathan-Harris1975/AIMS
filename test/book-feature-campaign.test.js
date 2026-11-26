import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { BookFeatureRepository } from "../services/outreach/bookFeature/repository.js";
import { scheduledLondonOccurrence } from "../services/outreach/bookFeature/core.js";
import { runBookFeatureAssessment, resolveWeeklyBook, analysePublishedBook } from "../services/outreach/bookFeature/run.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../services/comms-hub/migrations/0028_book_feature_outreach.sql", import.meta.url), "utf8"));
  const query = async (sql, values = []) => {
    const statement = db.prepare(sql);
    if (/^\s*(?:SELECT|PRAGMA)/i.test(sql)) return { results: statement.all(...values), meta: { changes: 0 } };
    const result = statement.run(...values);
    return { results: [], meta: { changes: result.changes } };
  };
  return { db, d1: { query, batch: async (statements) => statements.reduce(async (previous, statement) =>
    [...await previous, await query(statement.sql, statement.params)], Promise.resolve([])) } };
}

const book = { ebookId: 20, title: "Published Book", author: "Author", bookUrl: "https://example.com/book",
  buyNowUrl: "https://example.com/book/buy-now",
  coverArtUrl: "https://example.com/cover", manuscriptR2Key: "Manuscripts pdf format/exact.pdf",
  storageBucket: "kdp", publicationDate: "2025-01-01" };

test("mode transitions are versioned and cannot activate dispatch", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  const repository = new BookFeatureRepository(d1, { leaseId: () => "audit1" });
  assert.equal((await repository.mode()).effective, "assessment");
  assert.equal((await repository.transitionMode("shadow", "operator", 1)).version, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM book_feature_audit").get().count, 1);
  await assert.rejects(repository.transitionMode("production", "operator", 2));
  await assert.rejects(repository.transitionMode("assessment", "operator", 1));
  assert.equal((await repository.mode({ BOOK_FEATURE_OUTREACH_MODE: "suspended" })).effective, "suspended");
  const overview = await repository.overview();
  assert.equal(overview.opportunities.total, 0);
  assert.equal(overview.actualCostUsd, null);
  assert.equal(overview.deliveryRate, null);
});

test("a selected campaign cannot silently change and occurrences cannot overlap", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  const repository = new BookFeatureRepository(d1, { now: () => new Date("2026-07-07T08:00:00Z"), leaseId: () => "lease1" });
  const occurrence = scheduledLondonOccurrence(new Date("2026-07-07T08:00:00Z"));
  const campaign = await repository.campaign(occurrence.week, book, { method: "weekly" });
  await assert.rejects(repository.campaign(occurrence.week, { ...book, ebookId: 22 }, {}));
  await assert.rejects(repository.campaign(occurrence.week, { ...book, author: "Other author" }, { method: "weekly" }));
  await assert.rejects(repository.campaign(occurrence.week, { ...book, coverArtUrl: "https://example.com/new-cover" }, { method: "weekly" }));
  await assert.rejects(repository.campaign(occurrence.week, book, { method: "reselected" }));
  const passage = " Acme Group delivered a useful platform with meaningful practical outcomes for its customers.";
  const candidates = [{ name: "Acme Group", occurrences: [{ pdfPage: 4, offset: 120, nameOffsetInPassage: 1, passage }] }];
  const sourcePages = [{ pdfPage: 4, text: `${" ".repeat(119)}${passage}`, textOffsetStart: 0 }];
  const checksum = "b".repeat(64);
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, candidates, sourcePages), { attempted: 1, recorded: 1 });
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, candidates, sourcePages), { attempted: 1, recorded: 0 });
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, [
    { name: "Invented Org", occurrences: [{ pdfPage: 5, offset: 0, passage }] },
  ], sourcePages), { attempted: 0, recorded: 0 });
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, candidates), { attempted: 0, recorded: 0 });
  const forged = [{ name: "Acme Group", occurrences: [{ pdfPage: 4, offset: 120, nameOffsetInPassage: 0, passage: "Acme Group made a completely different claim with enough characters." }] }];
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, forged, sourcePages), { attempted: 0, recorded: 0 });
  await assert.rejects(repository.recordCandidateEvidence(campaign.id, "not-a-checksum", candidates, sourcePages), /SHA-256/);
  const batchSizes = [];
  const originalBatch = d1.batch;
  d1.batch = async (statements) => { batchSizes.push(statements.length); return originalBatch(statements); };
  const manyCandidates = Array.from({ length: 205 }, (_, index) => ({
    name: `Organisation ${index}`,
    occurrences: [{ pdfPage: index + 1, offset: 0, nameOffsetInPassage: 0, passage: `Organisation ${index} produced a useful product with documented practical results.` }],
  }));
  const manyPages = manyCandidates.map((candidate, index) => ({ pdfPage: index + 1, text: candidate.occurrences[0].passage, textOffsetStart: 0 }));
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, manyCandidates),
    { attempted: 0, recorded: 0 });
  assert.deepEqual(await repository.recordCandidateEvidence(campaign.id, checksum, manyCandidates, manyPages),
    { attempted: 205, recorded: 205 });
  assert.deepEqual(batchSizes, [100, 100, 5]);
  const lease = await repository.claimOccurrence(occurrence, campaign.id);
  assert.ok(lease);
  assert.equal(await repository.claimOccurrence(occurrence, campaign.id), null);
  await repository.finishOccurrence(lease, "completed_zero", { reportKey: "private/report.json" });
  assert.equal(await repository.claimOccurrence(occurrence, campaign.id), null);
  assert.equal((await repository.getOccurrence(occurrence.id)).attempts, 1);
});

test("renewed Book Feature leases prevent stale occurrence recovery and fence old owners", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  let current = new Date("2026-07-07T08:00:00.000Z");
  let sequence = 0;
  const repository = new BookFeatureRepository(d1, { now: () => current, leaseMs: 1000, leaseId: () => `lease-${++sequence}` });
  const occurrence = scheduledLondonOccurrence(current);
  const campaign = await repository.campaign(occurrence.week, book, {});
  const first = await repository.claimOccurrence(occurrence, campaign.id);
  current = new Date("2026-07-07T08:00:00.800Z");
  assert.equal(await repository.renewOccurrence(first), true);
  current = new Date("2026-07-07T08:00:01.200Z");
  assert.equal(await repository.claimOccurrence(occurrence, campaign.id), null);
  current = new Date("2026-07-07T08:00:01.900Z");
  const recovered = await repository.claimOccurrence(occurrence, campaign.id);
  assert.ok(recovered);
  assert.equal(await repository.renewOccurrence(first), false);
  await assert.rejects(repository.finishOccurrence(first, "completed_zero"), /taken by another worker/);
});

test("long Book Feature assessment renews its occurrence lease while PDF analysis runs", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  const repository = new BookFeatureRepository(d1, { leaseMs: 30 });
  const now = new Date("2026-07-07T08:00:00.000Z");
  const occurrence = scheduledLondonOccurrence(now);
  let competingClaim;
  const result = await runBookFeatureAssessment({ repository, now,
    resolveBook: async () => ({ book, selection: {} }),
    analyse: async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      const row = await repository.getOccurrence(occurrence.id);
      competingClaim = await repository.claimOccurrence(occurrence, row.campaign_id);
      return { sha256: "c".repeat(64), totalPages: 1, pagesAnalysed: 1, candidates: [], sourcePages: [], cacheKey: "private/cache" };
    }, persist: async () => {}, heartbeatIntervalMs: 10 });
  assert.equal(result.status, "completed_zero");
  assert.equal(competingClaim, null);
});

test("a cleanup lease failure preserves the original assessment failure", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  const repository = new BookFeatureRepository(d1, { now: () => new Date("2026-07-07T08:00:00Z") });
  repository.finishOccurrence = async () => { throw new Error("lease taken"); };
  const failure = new Error("PDF extraction failed");
  await assert.rejects(runBookFeatureAssessment({ repository, now: new Date("2026-07-07T08:00:00Z"),
    resolveBook: async () => ({ book, selection: {} }), analyse: async () => { throw failure; } }), (error) => {
    assert.equal(error, failure);
    assert.equal(error.cleanupError.message, "lease taken");
    return true;
  });
});

test("scheduled assessment accepts GMT/BST and bounded catch-up but no other weekday", () => {
  assert.equal(scheduledLondonOccurrence(new Date("2026-07-07T08:00:00Z"))?.day, "Tue");
  assert.equal(scheduledLondonOccurrence(new Date("2026-12-08T09:00:00Z"))?.day, "Tue");
  assert.equal(scheduledLondonOccurrence(new Date("2026-07-09T09:30:00Z"))?.day, "Thu");
  assert.equal(scheduledLondonOccurrence(new Date("2026-07-09T10:01:00Z")), null);
  assert.equal(scheduledLondonOccurrence(new Date("2026-07-10T08:00:00Z")), null);
});

test("scheduled run holds the same weekly book and never dispatches", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  const repository = new BookFeatureRepository(d1, { now: () => new Date("2026-07-07T08:00:00Z"), leaseId: () => "lease2" });
  const writes = [];
  const base = { repository, now: new Date("2026-07-07T08:00:00Z"), resolveBook: async () => ({ book, selection: {} }),
    analyse: async () => ({ sha256: "a".repeat(64), totalPages: 10, pagesAnalysed: 10,
      candidates: [{ name: "Acme Group", occurrences: [{ pdfPage: 4, offset: 120,
        nameOffsetInPassage: 0,
        passage: "Acme Group delivered a useful platform with meaningful practical outcomes for its customers." }] }],
      sourcePages: [{ pdfPage: 4,
        text: `${" ".repeat(120)}Acme Group delivered a useful platform with meaningful practical outcomes for its customers.`,
        textOffsetStart: 0 }], cacheKey: "private/extract" }),
    persist: async (...args) => writes.push(args) };
  const first = await runBookFeatureAssessment(base);
  assert.equal(first.status, "completed_zero");
  assert.equal(first.dispatched, 0);
  assert.equal(first.candidateEvidenceRecorded, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM book_feature_evidence WHERE validation='candidate'").get().n, 1);
  assert.equal(Object.hasOwn(first, "privateReportKey"), false);
  assert.equal(writes.length, 1);
  assert.equal((await runBookFeatureAssessment(base)).status, "already_completed");
  const thursday = await runBookFeatureAssessment({ ...base, now: new Date("2026-07-09T08:00:00Z") });
  assert.equal(thursday.campaignId, first.campaignId);
  assert.notEqual(thursday.occurrenceId, first.occurrenceId);
});

test("authoritative selection refuses fallback, ambiguity and week mismatch", async () => {
  const sponsor = async () => ({ source: "fallback", title: book.title, url: book.bookUrl });
  await assert.rejects(resolveWeeklyBook("2026-W28", { sponsor, listBooks: async () => [book] }));
  await assert.rejects(resolveWeeklyBook("2026-W28", {
    sponsor: async () => ({ source: "featured-book-api", title: book.title, url: book.bookUrl, selection: { iso_week: 27 } }),
    listBooks: async () => [book] }));
  await assert.rejects(resolveWeeklyBook("2026-W28", {
    sponsor: async () => ({ source: "featured-book-api", title: book.title, url: book.bookUrl }),
    listBooks: async () => [book, book] }));
  const accepted = await resolveWeeklyBook("2026-W28", {
    sponsor: async () => ({ source: "featured-book-api", title: book.title, url: book.buyNowUrl,
      selection: { iso_week: 28, year: 2026 } }), listBooks: async () => [book] });
  assert.equal(accepted.book.ebookId, 20);
});

test("PDF cache is keyed to content and refuses incomplete coverage", async () => {
  const buffer = Buffer.from("%PDF-" + "x".repeat(100));
  let extracts = 0;
  let cached;
  const options = { readObject: async () => buffer,
    readCache: async () => { if (!cached) throw Object.assign(new Error("missing"), { name: "NoSuchKey" }); return JSON.stringify(cached); },
    writeCache: async (_bucket, _key, value) => { cached = value; },
    extract: async () => { extracts++; return { sha256: createHash("sha256").update(buffer).digest("hex"), totalPages: 1, pagesAnalysed: 1, coverageComplete: true, complete: true,
      pages: [{ pdfPage: 1, text: "A verified example of an ordinary sentence with enough words.", readable: true }] }; } };
  await analysePublishedBook(book, options);
  await analysePublishedBook(book, options);
  assert.equal(extracts, 1);
  assert.equal(cached.configVersion, "book-feature-pdf-v1");
});
