import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dir, "../services/kdp/engine/browser/fillBookContent.js"), "utf8");

function form(prefix) {
  const fields = new Map();
  const add = (suffix, initial = "", radioValue = null) => {
    const name = `data[${prefix}]${suffix}`;
    const item = { value: radioValue ?? initial, checked: false, dispatchEvent() {} };
    fields.set(name + (radioValue === null ? "" : ":" + radioValue), item);
    return item;
  };
  const width = add("[trim_size][width]");
  const height = add("[trim_size][height]");
  const ink = add("[ink_and_paper]", "", "BW_WHITE");
  const bleed = add("[interior_has_bleed]", "", "false");
  const document = {
    querySelector(selector) {
      const match = /^input\[name="([^"]+)"\](?:\[value="([^"]+)"\])?$/.exec(selector);
      if (!match) return null;
      return fields.get(match[1] + (match[2] === undefined ? "" : ":" + match[2])) || null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const fn = vm.runInNewContext(`(${source})`, { document, Event: class Event {} });
  return { fn, width, height, ink, bleed };
}

for (const prefix of ["print_book", "hardcover_book"]) {
  test(`fillPrintContent uses present ${prefix} fields rather than silently skipping them`, () => {
    const { fn, width, height, ink, bleed } = form(prefix);
    const result = fn({
      trimWidthIn: 6,
      trimHeightIn: 9,
      inkAndPaper: "black_and_white",
      interiorHasBleed: false,
    }, prefix === "hardcover_book" ? "hardcover" : "paperback");
    assert.deepEqual(Array.from(result.skipped), []);
    assert.deepEqual(Array.from(result.filled), ["trimSize", "inkAndPaper", "interiorHasBleed"]);
    assert.equal(width.value, "600");
    assert.equal(height.value, "900");
    assert.equal(ink.checked, true);
    assert.equal(bleed.checked, true);
  });
}

test("missing print form fields are reported as skipped rather than claimed filled", () => {
  const document = { querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; } };
  const fn = vm.runInNewContext(`(${source})`, { document, Event: class Event {} });
  const result = fn({ trimWidthIn: 6, trimHeightIn: 9, interiorHasBleed: false });
  assert.deepEqual(Array.from(result.skipped), ["trimSize", "interiorHasBleed"]);
});

test("hardcover pricing selects an actual hardcover USD field, not a Kindle price", () => {
  const pricingSource = fs.readFileSync(
    path.join(dir, "../services/kdp/engine/browser/fillBookPricing.js"), "utf8",
  );
  const input = { value: "", dispatchEvent() {} };
  const selector = 'input[name="data[hardcover_book][list_price][USD][amount]"]';
  const document = {
    querySelector(candidate) { return candidate === selector ? input : null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const fn = vm.runInNewContext(`(${pricingSource})`, { document, Event: class Event {} });
  const applied = fn("hardcover", { listPriceUsd: "16.99" });
  assert.deepEqual(Array.from(applied.filled), ["listPriceUsd"]);
  assert.deepEqual(Array.from(applied.skipped), []);
  assert.equal(input.value, "16.99");
});

test("a paperback form with both namespaces updates paperback fields only", () => {
  const fields = new Map();
  for (const prefix of ["print_book", "hardcover_book"]) {
    fields.set(`data[${prefix}][trim_size][width]`, { value: "", dispatchEvent() {} });
    fields.set(`data[${prefix}][trim_size][height]`, { value: "", dispatchEvent() {} });
  }
  const document = {
    querySelector(selector) {
      const match = /^input\[name="([^"]+)"\]$/.exec(selector);
      return match ? fields.get(match[1]) || null : null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const fn = vm.runInNewContext(`(${source})`, { document, Event: class Event {} });
  fn({ trimWidthIn: 6, trimHeightIn: 9 }, "paperback");
  assert.equal(fields.get("data[print_book][trim_size][width]").value, "600");
  assert.equal(fields.get("data[hardcover_book][trim_size][width]").value, "");
  fn({ trimWidthIn: 6, trimHeightIn: 9 }, "hardcover");
  assert.equal(fields.get("data[hardcover_book][trim_size][width]").value, "600");
});

test("AI questionnaire writes both the visible select and the matching hidden value", () => {
  const hidden = { value: "", dispatchEvent() {} };
  const select = { value: "", dispatchEvent() {} };
  const document = {
    querySelector(selector) {
      return selector === 'input[name="data[hardcover_book][generative_ai_questionnaire][text][amount_and_editing]"]'
        ? hidden : null;
    },
    querySelectorAll() { return []; },
    getElementById(id) { return id === "generative-ai-questionnaire-text" ? select : null; },
  };
  const fn = vm.runInNewContext(`(${source})`, { document, Event: class Event {} });
  const result = fn({ aiTextAmount: "some" }, "hardcover");
  assert.deepEqual(Array.from(result.skipped), []);
  assert.deepEqual(Array.from(result.filled), ["aiTextAmount"]);
  assert.equal(select.value, "some");
  assert.equal(hidden.value, "some");
});

test("AI questionnaire does not claim a value persisted when no field exists", () => {
  const document = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const fn = vm.runInNewContext(`(${source})`, { document, Event: class Event {} });
  const result = fn({ containsAiContent: true, aiTextAmount: "some" }, "hardcover");
  assert.deepEqual(Array.from(result.skipped), ["aiTextAmount", "containsAiContent"]);
});
