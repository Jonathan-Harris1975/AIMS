import test from "node:test";
import assert from "node:assert/strict";
import { selectSample, verifyBook, londonOccurrence, matchedPassage, scoreOpportunity, effectiveMode } from "../services/outreach/bookFeature/core.js";
import { extractManuscript, candidateReferences, assessBook, assessThreeBooks, validateExtraction } from "../services/outreach/bookFeature/assessment.js";
import { statusUrlFor } from "../services/shared/utils/asyncServiceStatusUrl.js";
import express from "express";
import request from "supertest";
import outreachRouter from "../services/outreach/routes/index.js";

const book = (id) => ({ ebookId: id, title: `Book ${id}`, bookUrl: `https://example.org/${id}`, storageBucket: "kdp",
  manuscriptR2Key: `Manuscripts pdf format/${id}.pdf`, publicationDate: "2025-01-01" });

test("seeded three-book selection is reproducible, records exclusions, and does not replace failed titles", async () => {
  const books = [book(7), book(3), book(11), book(5), { ...book(9), publicationDate: null }];
  const first = selectSample(books, "acceptance-2026");
  assert.deepEqual(first, selectSample(books.reverse(), "acceptance-2026"));
  assert.equal(first.exclusions, 1);
  const report = await assessThreeBooks("acceptance-2026", { listBooks: async () => books,
    assess: async (b) => { if (b.ebookId === first.selected[1]) throw new Error("missing object"); return { ebookId: b.ebookId, status: "candidate_review_required" }; },
    persist: async (_bucket, _key, result) => assert.equal(result.books.length, 3) });
  assert.equal(report.completeAnalyses, 2);
  assert.deepEqual(report.books.map((b) => b.ebookId), first.selected);
  assert.equal(report.dispatched, 0);
});

test("featured metadata, passage matching, scoring and dispatch mode fail closed", () => {
  assert.throws(() => verifyBook({ title: "Different" }, book(1)));
  assert.throws(() => verifyBook({ title: "Book 1", bookUrl: "https://other.example" }, book(1)));
  assert.throws(() => verifyBook({ title: "Book 1" }, { ...book(1), publicationDate: "2099-01-01" }));
  assert.throws(() => verifyBook({ title: "Book 1" }, { ...book(1), titleAlignmentStatus: "Mismatch" }));
  const canonical = "Artificial Intelligence in Construction: Building a Sustainable Future";
  const caseDrift = { ...book(1), title: canonical,
    manuscriptTitleObserved: "Artificial intelligence in Construction: Building a Sustainable Future",
    titleAlignmentStatus: "Minor punctuation/casing drift; workbook retained as canonical" };
  assert.equal(verifyBook({ title: canonical, bookUrl: caseDrift.bookUrl }, caseDrift), caseDrift);
  assert.throws(() => verifyBook({ title: canonical, bookUrl: caseDrift.bookUrl },
    { ...caseDrift, manuscriptTitleObserved: "Artificial intelligence in Construction: A Different Future" }));
  assert.equal(matchedPassage("The Acme Group developed reliable services.", "Acme Group developed reliable services."), true);
  assert.equal(matchedPassage("The Acme Group developed reliable services.", "Acme Group recommends my book."), false);
  const components = { depth: 25, positiveContext: 20, mutualBenefit: 20, currentRelevance: 15, audienceAlignment: 10, relationshipPotential: 10 };
  const score = scoreOpportunity(components, { evidence: true });
  assert.equal(score.score, 100);
  assert.equal(score.eligible, false);
  assert.ok(score.failedGates.includes("authorisation"));
  assert.equal(effectiveMode("production", "production"), "shadow");
  assert.equal(effectiveMode("suspended", "production"), "suspended");
});

test("conditional Book Feature scores require enhanced validation and preserve mandatory gates", () => {
  const gates = { evidence: true, identity: true, contact: true, lawfulBasis: true, suppression: true,
    duplicate: true, qa: true, campaign: true, authorisation: true };
  const components = { depth: 15, positiveContext: 12, mutualBenefit: 12, currentRelevance: 10, audienceAlignment: 6, relationshipPotential: 5 };
  const conditional = scoreOpportunity(components, gates);
  assert.equal(conditional.score, 60);
  assert.equal(conditional.tier, "conditional");
  assert.equal(conditional.eligible, false);
  assert.ok(conditional.failedGates.includes("enhancedValidation"));
  assert.equal(scoreOpportunity(components, { ...gates, enhancedValidation: true }).eligible, true);
  const strong = scoreOpportunity({ ...components, depth: 25 }, gates);
  assert.equal(strong.score, 70);
  assert.equal(strong.tier, "strong");
  assert.equal(strong.eligible, true);
  assert.equal(scoreOpportunity({ ...components, depth: 25, positiveContext: 7 }, { ...gates, evidence: false }).eligible, false);
});

test("London 09:00 occurrences preserve wall time across BST and GMT", () => {
  assert.equal(londonOccurrence(new Date("2026-07-07T08:00:00Z"))?.day, "Tue");
  assert.equal(londonOccurrence(new Date("2026-12-08T09:00:00Z"))?.day, "Tue");
  assert.equal(londonOccurrence(new Date("2026-07-07T09:00:00Z")), null);
  assert.equal(londonOccurrence(new Date("2026-07-09T08:00:00Z"))?.day, "Thu");
});

test("PDF extraction checks every page and blocks deficient coverage", async () => {
  const documentLoader = () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 2, getPage: async (index) => ({
    getTextContent: async () => ({ items: index === 1 ? [{ str: "Acme Group developed a useful tool with verified benefits." }] : [] }), cleanup() {},
  }), destroy: async () => {} }) });
  const result = await extractManuscript(Buffer.from("%PDF-" + "x".repeat(100)), { documentLoader });
  assert.equal(result.totalPages, 2);
  assert.equal(result.pagesProcessed, 2);
  assert.equal(result.pagesAnalysed, 2);
  assert.equal(result.readablePages, 1);
  assert.deepEqual(result.coverageManifest.map((page) => page.status), ["readable", "no_text_content"]);
  assert.equal(result.pages[0].textOffsetStart, 0);
  assert.equal(result.pages[0].textOffsetEnd, result.pages[0].text.length);
  assert.equal(result.pages[1].textOffsetStart, result.pages[0].text.length + 1);
  assert.equal(result.pages[1].textOffsetEnd, result.pages[1].textOffsetStart);
  assert.deepEqual(result.deficientPages, [2]);
  assert.equal(result.complete, false);
  assert.equal(validateExtraction(result), false);
});

test("read-only assessment rejects extraction whose checksum does not match the retrieved manuscript", async () => {
  const buffer = Buffer.from("%PDF-" + "x".repeat(100));
  const extraction = { sha256: "wrong-checksum", totalPages: 1, pagesProcessed: 1, pagesAnalysed: 1,
    readablePages: 1, coverageComplete: true, complete: true,
    pages: [{ pdfPage: 1, text: "A sufficiently long page with readable manuscript evidence.", characters: 56, readable: true }] };
  await assert.rejects(assessBook(book(1), { readObject: async () => buffer, extract: async () => extraction }), /checksum/);
});

test("candidate passage offsets use the cumulative normalized manuscript text position", async () => {
  const pagesText = [
    "This first page contains enough readable introductory text for coverage.",
    "Acme Group developed a useful product with independently verifiable benefits.",
  ];
  const result = await extractManuscript(Buffer.from("%PDF-" + "x".repeat(100)), { documentLoader: () => ({
    destroy: async () => {}, promise: Promise.resolve({ numPages: pagesText.length,
      getPage: async (index) => ({ getTextContent: async () => ({ items: [{ str: pagesText[index - 1] }] }), cleanup() {} }),
    }),
  }) });
  const reference = candidateReferences(result).find((candidate) => candidate.name === "Acme Group");
  assert.ok(reference);
  assert.equal(reference.occurrences[0].pdfPage, 2);
  assert.equal(reference.occurrences[0].offset, pagesText[0].length + 1);
});

test("extraction validation requires contiguous, readable page coverage", () => {
  const valid = { totalPages: 2, pages: [
    { pdfPage: 1, text: "A sufficiently long page with readable extracted content.", readable: true },
    { pdfPage: 2, text: "Another sufficiently long page with readable extracted content.", readable: true },
  ], coverageComplete: true, complete: true };
  assert.equal(validateExtraction(valid), true);
  assert.equal(validateExtraction({ ...valid, coverageComplete: false, complete: false }), false);
  assert.equal(validateExtraction({ ...valid, pages: [valid.pages[0]] }), false);
  assert.equal(validateExtraction({ ...valid, pages: [{ ...valid.pages[0], pdfPage: 2 }, valid.pages[1]] }), false);
  assert.equal(validateExtraction({ ...valid, pages: [valid.pages[0], { ...valid.pages[1], readable: false }], complete: false }), false);
});

test("assessment job polling URL resolves to its registered route", async () => {
  const url = statusUrlFor(null, "book-feature", "assessment", "three-books-seed", "/outreach/book-feature/jobs");
  assert.equal(url, "/outreach/book-feature/jobs/assessment/three-books-seed");
  const app = express();
  app.use("/outreach", outreachRouter);
  const response = await request(app).get(url);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { ok: false, error: "Assessment job not found." });
});

test("mode endpoint refuses production activation without reaching storage", async () => {
  const app = express(); app.use("/outreach", outreachRouter);
  const response = await request(app).put("/outreach/book-feature/mode")
    .send({ mode: "production", expectedVersion: 1 });
  assert.equal(response.status, 400);
});
