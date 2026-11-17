import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrintCover, parsePdfInfo, validatePrintSourceText } from "../services/kdp/printAssets.js";
import { calculatePrintPrice, planPrintPrices } from "../services/kdp/printPricePolicy.js";
import { utcPrintWeek, canAttemptPrintJob } from "../services/kdp/printState.js";
import { existingPrintMatches, choosePrintCandidates, printWindowAllowsAction,
  runPrintProduction } from "../services/kdp/printProduction.js";
import { normalizeAiDeclaration } from "../services/kdp/printAiDisclosure.js";
import { publicPurchaseControls, verifyPrintIdentity } from "../services/kdp/printVerification.js";

test("6x9 black-ink print cover geometry uses the official paperback spine formula", () => {
  const cover = calculatePrintCover("paperback", 178);
  assert.ok(Math.abs(cover.width - 12.650856) < .00001);
  assert.equal(cover.height, 9.25);
  assert.ok(calculatePrintCover("hardcover", 178).width > cover.width);
  assert.throws(() => calculatePrintCover("hardcover", 75), /76/);
  assert.throws(() => calculatePrintCover("paperback", 23), /Invalid/);
});

test("UK paperback and hardback estimated direct-sale royalties exceed £4.50", () => {
  for (const format of ["paperback","hardcover"]) {
    const uk = calculatePrintPrice(format, 178, "GBP");
    assert.ok(uk.estimatedRoyalty >= 4.50);
    assert.ok(Number(uk.price) > 7.99);
    assert.equal(uk.royaltyRate, .6);
    const us = calculatePrintPrice(format, 178, "USD");
    assert.ok(us.estimatedRoyalty >= 6);
    assert.deepEqual(planPrintPrices(format,178).pricing.prices, { GBP:uk.price,USD:us.price });
  }
  assert.equal(calculatePrintPrice("paperback", 50, "GBP").printCost, 1.93);
  assert.equal(calculatePrintPrice("hardcover", 85, "GBP").printCost, 5.23);
  assert.throws(() => calculatePrintPrice("hardcover", 560, "USD"), /Hardcover/);
});

test("PDF information and text readiness never pretend a missing interior is printable", () => {
  assert.deepEqual(parsePdfInfo("Pages: 178\nPage size: 432 x 648 pts\n"),
    { pages:178,widthPt:432,heightPt:648 });
  assert.throws(() => parsePdfInfo("Pages: 99\n"), /geometry/);
  assert.throws(() => validatePrintSourceText("short text"), /too little/);
  assert.equal(validatePrintSourceText(Array(1100).fill("print").join(" ")).words.length, 1100);
});

test("KDP print weekly accounting resets Sunday at 00:00 UTC, independently of London clocks", () => {
  assert.equal(utcPrintWeek(new Date("2026-11-17T19:00:00Z")),"2026-11-15");
  assert.equal(utcPrintWeek(new Date("2026-11-22T00:00:00Z")),"2026-11-22");
  assert.equal(canAttemptPrintJob(null),true);
  for (const state of ["creating","submitting","uncertain","submitted","live_verified"]) {
    assert.equal(canAttemptPrintJob({state}),false);
  }
  assert.equal(canAttemptPrintJob({state:"blocked",updatedAt:"2026-11-17T19:00:00Z"},
    new Date("2026-11-18T19:00:00Z")),false);
  assert.equal(canAttemptPrintJob({state:"blocked",updatedAt:"2026-11-15T18:00:00Z"},
    new Date("2026-11-18T19:00:00Z")),true);
  assert.equal(printWindowAllowsAction(new Date("2026-11-18T22:15:00Z"),{start:true}),true);
  assert.equal(printWindowAllowsAction(new Date("2026-11-18T22:50:00Z"),{start:true}),false);
  assert.equal(printWindowAllowsAction(new Date("2026-11-20T22:15:00Z")) ,false);
});

test("print worker sorts pilot title first and rejects uncertain duplicate KDP print identities", () => {
  const books = [{ebookId:2},{ebookId:7},{ebookId:1}];
  assert.deepEqual(choosePrintCandidates(books).map(b=>b.ebookId),[7,1,2]);
  assert.throws(() => choosePrintCandidates([{ebookId:3},{ebookId:3}]),/Invalid/);
  const shelf = {refs:[{titleId:"ABC1234567",format:"paperback",title:"Book Seven"}], pagesScanned:1};
  assert.equal(existingPrintMatches(shelf,{title:"Book Seven"},"paperback").length,1);
  assert.throws(() => existingPrintMatches({refs:[{format:"paperback",titleId:"AC0123456789"}],pagesScanned:1},
    {title:"Unknown"},"paperback"),/unverified title/);
});

test("AI declaration cannot be guessed: it must match signed-in Kindle fields", () => {
  assert.deepEqual(normalizeAiDeclaration({contains:"NO"}), {containsAiContent:false});
  assert.throws(() => normalizeAiDeclaration({}),/not verifiable/);
  assert.throws(() => normalizeAiDeclaration({contains:"YES"}),/incomplete/);
  assert.deepEqual(normalizeAiDeclaration({
    contains:"YES",textAmount:"some",textTool:"ChatGPT",
    imagesAmount:"none", translationsAmount:"none",
  }), {containsAiContent:true,aiTextAmount:"some",aiTextTool:"ChatGPT",
    aiImagesAmount:"none",aiTranslationsAmount:"none"});
});

test("retail verification demands matching title, print ISBN, separate ASIN and purchase button", () => {
  const book={title:"One Good Book",asin:"B012345678"};
  const job={titleId:"AC1234567890",isbn:"9781234567897"};
  const kdp={isbn:job.isbn,asin:"123456789X",title:book.title,publishingStatus:"Live"};
  const retail={title:book.title,asin:kdp.asin,isbn13:job.isbn,price:"£16.99"};
  const data={book,format:"paperback",job,kdp,retail,hasPurchaseControl:true};
  assert.equal(verifyPrintIdentity(data),true);
  assert.equal(verifyPrintIdentity({...data,hasPurchaseControl:false}),false);
  assert.equal(verifyPrintIdentity({...data,kdp:{...kdp,asin:book.asin}}),false);
  assert.equal(verifyPrintIdentity({...data,retail:{...retail,isbn13:"9781111111111"}}),false);
  assert.equal(verifyPrintIdentity({...data,kdp:{...kdp,publishingStatus:"In Review"}}),false);
  assert.equal(publicPurchaseControls('<input id="add-to-cart-button">'),true);
  assert.equal(publicPurchaseControls('<div>Currently unavailable<input id="add-to-cart-button"></div>'),false);
});

test("dry-run never starts KDP login, D1 reservations or title creation", async () => {
  const result = await runPrintProduction({dryRun:true,
    listBooks:async()=>{throw new Error("Must not access KDP");},
    inspectBookshelf:async()=>{throw new Error("Must not access KDP");}});
  assert.equal(result.ok,true);
  assert.equal(result.kdpWritesPerformed,false);
});
