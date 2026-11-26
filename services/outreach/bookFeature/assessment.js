import { createHash } from "node:crypto";
import { getDocument, version as extractorVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import { getObjectAsBuffer, putPrivateJson } from "../../shared/utils/r2-client.js";
import { listKdpEbooks } from "../../kdp/catalogue.js";
import { selectSample, verifyBook } from "./core.js";

const MAX_BYTES = 30 * 1024 * 1024;
const CANDIDATE = /\b(?:[A-Z][\p{L}\p{N}&'-]+\s+){1,3}(?:[A-Z][\p{L}\p{N}&'-]+)\b/gu;
const GENERIC = /^(?:Table of Contents|About the Author|United Kingdom|Artificial Intelligence|Chapter [A-Z]|The [A-Z])/;

export async function extractManuscript(buffer, { documentLoader = getDocument } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF signature.");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const task = documentLoader({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, stopAtErrors: true });
  const document = await task.promise;
  const pages = [];
  try {
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > 3000) throw new Error("Invalid manuscript page count.");
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
      pages.push({ pdfPage: index, text, characters: text.length, readable: text.length >= 30 });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const deficient = pages.filter((page) => !page.readable).map((page) => page.pdfPage);
  return { sha256, extractorVersion, pages, totalPages: pages.length, pagesAnalysed: pages.length - deficient.length,
    deficientPages: deficient, complete: deficient.length === 0 };
}

// Candidate enumeration is deliberately conservative: no unverified name or passage becomes an outreach claim.
export function candidateReferences(extraction) {
  const candidates = new Map();
  for (const page of extraction.pages) {
    for (const match of page.text.matchAll(CANDIDATE)) {
      const name = match[0].trim();
      if (GENERIC.test(name)) continue;
      const before = Math.max(0, match.index - 90);
      const after = Math.min(page.text.length, match.index + name.length + 90);
      const passage = page.text.slice(before, after);
      const row = candidates.get(name) || { name, occurrences: [] };
      row.occurrences.push({ pdfPage: page.pdfPage, offset: match.index, passage });
      candidates.set(name, row);
    }
  }
  return [...candidates.values()].sort((a, b) => b.occurrences.length - a.occurrences.length || a.name.localeCompare(b.name));
}

export async function assessBook(book, { readObject = getObjectAsBuffer, extract = extractManuscript } = {}) {
  verifyBook({ title: book.title, bookUrl: book.bookUrl }, book);
  const buffer = await readObject("kdp", book.manuscriptR2Key, { maxBytes: MAX_BYTES });
  const extraction = await extract(buffer);
  return {
    ebookId: book.ebookId, title: book.title, published: book.publicationDate, manuscriptSha256: extraction.sha256,
    extractorVersion: extraction.extractorVersion, totalPages: extraction.totalPages,
    pagesAnalysed: extraction.pagesAnalysed, deficientPages: extraction.deficientPages,
    status: extraction.complete ? "candidate_review_required" : "blocked_incomplete_extraction",
    candidates: extraction.complete ? candidateReferences(extraction) : [],
    qualifiedOpportunities: 0, contactEligibleOpportunities: 0,
    limitations: ["Names are unverified text candidates; ownership, sentiment, score, contact and legal eligibility require independent validation.",
      ...(extraction.complete ? [] : ["Unreliable pages require OCR or extraction repair before qualification."])],
  };
}

export async function assessThreeBooks(seed, { listBooks = listKdpEbooks, assess = assessBook, persist = putPrivateJson } = {}) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(seed)) throw new Error("Use a short reproducible alphanumeric seed.");
  const books = await listBooks();
  const selection = selectSample(books, seed);
  const results = [];
  for (const id of selection.selected) {
    const book = books.find((entry) => entry.ebookId === id);
    try { results.push(await assess(book)); }
    catch (error) { results.push({ ebookId: id, title: book.title, status: "blocked", error: error.code || error.message }); }
  }
  const report = { service: "book_feature_outreach", mode: "assessment", dispatched: 0, selection,
    observedAt: new Date().toISOString(), completeAnalyses: results.filter((result) => result.status === "candidate_review_required").length,
    books: results };
  const key = `outreach/book-feature/assessments/${seed}.json`;
  await persist("kdp", key, report);
  return { ...report, privateReportKey: key };
}
