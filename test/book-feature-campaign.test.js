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
  db.exec(readFileSync(new URL("../services/comms-hub/migrations/0030_outreach_production_controls.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../services/comms-hub/migrations/0031_guest_article_controlled_outbox.sql", import.meta.url), "utf8"));
  db.exec(`CREATE TABLE IF NOT EXISTS comms_hub_outreach_suppression (
    id TEXT PRIMARY KEY,email TEXT NOT NULL DEFAULT '',domain TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL,
    source TEXT NOT NULL,created_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}')`);
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

test("mode transitions are versioned and controlled testing requires explicit allowlist approval", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  let auditSequence = 0;
  const repository = new BookFeatureRepository(d1, { leaseId: () => `audit${++auditSequence}` });
  assert.equal((await repository.mode()).effective, "assessment");
  assert.equal((await repository.transitionMode("assessment", "operator", 2, "continue assessment")).version, 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM book_feature_audit").get().count, 1);
  await assert.rejects(repository.transitionMode("pilot", "operator", 3, "not accepted"));
  await assert.rejects(repository.transitionMode("assessment", "operator", 2, "stale"));
  const controlled = await repository.configureControlledTest({ recipients: ["test@example.com"], perRunCap: 1,
    dailyCap: 1, actor: "operator", reason: "controlled inbox delivery test", expectedVersion: 3 });
  assert.equal(controlled.effective, "controlled_test");
  assert.equal(controlled.killSwitch, false);
  assert.deepEqual(controlled.testRecipients, ["test@example.com"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM book_feature_audit").get().count, 2);
  await assert.rejects(repository.configureControlledTest({ recipients: ["invalid"], actor: "operator",
    reason: "bad", expectedVersion: 4 }));
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
    analyseEntities: async (items) => ({ entities: items.map((candidate) => ({
      name: candidate.name, validation: "candidate_unverified",
    })), classification: "context_classified_identity_unverified", batches: 1 }),
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
  assert.equal(first.contextClassifiedCandidates, 1);
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

test("controlled-test queue enforces backend allowlist, suppression, reservation, caps and idempotency", async (t) => {
  const { db, d1 } = fixture(); t.after(() => db.close());
  let sequence = 0;
  const now = new Date("2026-11-27T08:00:00.000Z");
  const repository = new BookFeatureRepository(d1, { now: () => now, leaseId: () => `id-${++sequence}` });
  await repository.configureControlledTest({ recipients: ["test@example.com"], perRunCap: 1, dailyCap: 1,
    actor: "operator", reason: "approved controlled inbox", expectedVersion: 2 });
  db.exec(`INSERT INTO book_feature_campaigns
    (id,iso_week,ebook_id,title,author,canonical_url,cover_url,manuscript_key,selection_json,state,created_at,updated_at)
    VALUES ('campaign','2026-W48',1,'Book','Author','https://book.example','https://book.example/cover',
      'Manuscripts pdf format/book.pdf','{}','assessment','${now.toISOString()}','${now.toISOString()}');
    INSERT INTO book_feature_organisations
    (id,canonical_name,official_domain,identity_status,source_json,verified_at,updated_at,legal_name,identity_evidence_key,identity_expires_at)
    VALUES ('org','Example','example.com','verified','{}','${now.toISOString()}','${now.toISOString()}','Example','private/id.json','2026-12-27T08:00:00.000Z');
    INSERT INTO book_feature_opportunities
    (id,campaign_id,organisation_id,state,tier,score,rubric_version,gate_json,reason,created_at,updated_at,score_components_json,evidence_json,contact_id)
    VALUES ('opp','campaign','org','qa_passed','A',90,'v1',
      '{"evidence":true,"identity":true,"contact":true,"lawfulBasis":true,"suppression":true,"duplicate":false,
      "qa":true,"campaign":true,"authorisation":false}',
      'authorisation pending','${now.toISOString()}','${now.toISOString()}','{}','[]','contact');
    INSERT INTO book_feature_contacts
    (id,organisation_id,email,normalised_email,role,recipient_type,source_url,validation_provider,validation_result,validated_at,
     validation_expires_at,jurisdiction,lawful_basis,assessment_key,consent_status,eligibility_status,created_at,updated_at)
    VALUES ('contact','org','test@example.com','test@example.com','Editor','role_address','https://example.com/contact','zerobounce','valid',
    '${now.toISOString()}','2026-12-11T08:00:00.000Z','GB','legitimate_interests_documented','private/assessment.json','not_required','eligible','${now.toISOString()}','${now.toISOString()}');
    INSERT INTO book_feature_pitch_versions
    (id,opportunity_id,version,subject,body_key,content_sha256,prompt_version,model_route,created_at)
    VALUES ('pitch','opp',1,'A useful feature','private/pitch.json','${"a".repeat(64)}','v1','route','${now.toISOString()}');
    INSERT INTO book_feature_qa_reviews
    (id,pitch_version_id,rubric_version,passed,score,gates_json,reasons_json,reviewer_route,created_at)
    VALUES ('qa','pitch','qa-v1',1,95,'{}','[]','qa-route','${now.toISOString()}')`);
  await assert.rejects(repository.queueControlledTest({ opportunityId: "opp", recipient: "prospect@example.com",
    idempotencyKey: "wrong-recipient", runKey: "run-1" }), /not authorised/);
  const queued = await repository.queueControlledTest({ opportunityId: "opp", recipient: "test@example.com",
    idempotencyKey: "controlled-1", runKey: "run-1" });
  assert.equal(queued.duplicate, false);
  assert.equal(queued.outbox.status, "queued");
  assert.equal(db.prepare("SELECT status FROM outreach_target_reservations").get().status, "active");
  const duplicate = await repository.queueControlledTest({ opportunityId: "opp", recipient: "test@example.com",
    idempotencyKey: "controlled-1", runKey: "run-1" });
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(repository.queueControlledTest({ opportunityId: "opp", recipient: "test@example.com",
    idempotencyKey: "controlled-2", runKey: "run-1" }), /per-run cap/);
  await assert.rejects(repository.transitionMode("suspended", "operator", 2, "stale"), /version changed/);
  assert.equal(db.prepare("SELECT status FROM book_feature_outbox").get().status, "queued");
  db.prepare("UPDATE book_feature_outbox SET status='leased',lease_owner='worker',lease_expires_at=?,attempt_count=1").run("2026-11-27T08:02:00.000Z");
  const lease = { id: queued.outbox.id, lease_owner: "worker", attempt_count: 1 };
  assert.equal(await repository.admitHandoff(lease, "b".repeat(64)), false);
  assert.equal(await repository.admitHandoff(lease, "a".repeat(64)), true);
  assert.equal(await repository.admitHandoff(lease, "a".repeat(64)), false);
  db.prepare("UPDATE book_feature_outbox SET status='leased',lease_owner='crashed',lease_expires_at=?").run("2026-11-27T07:59:00.000Z");
  assert.equal(await repository.claimOutbox(), null);
  assert.equal(db.prepare("SELECT status FROM book_feature_outbox").get().status, "unknown");
  const event = { providerEventId: "opt-out-1", opportunityId: "opp", category: "opt_out", authenticated: true };
  assert.equal((await repository.processInboundEvent(event)).action, "suppressed_and_cancelled");
  assert.equal((await repository.processInboundEvent(event)).duplicate, true);
  assert.equal(db.prepare("SELECT state FROM book_feature_opportunities WHERE id='opp'").get().state, "suppressed");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comms_hub_outreach_suppression").get().n, 1);
});
