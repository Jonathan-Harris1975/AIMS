import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../services/comms-hub/clients/oneComMailClient.js", import.meta.url), "utf8");

test("one.com IMAP errors retain a safe provider stage without logging credentials", () => {
  assert.match(source, /error\.providerStage = session\?\.stage \|\| providerStage/);
  assert.match(source, /upper\.startsWith\("LOGIN"\) \? "login"/);
  assert.doesNotMatch(source, /providerStage\s*=\s*commandText/);
});

test("one.com polling drains UIDs oldest-first so a full batch cannot skip earlier mail", () => {
  assert.match(source, /sort\(\(a, b\) => a - b\)\.slice\(0, boundedLimit\)/);
  assert.doesNotMatch(source, /slice\(-boundedLimit\)/);
});

test("one.com cursor uses UIDNEXT so expunged recent mail cannot move the watermark backwards", () => {
  assert.match(source, /UIDNEXT/);
  assert.match(source, /uidNext - 1/);
  assert.match(source, /cursorSource: "uidnext"/);
});

test("one.com socket reader avoids repeated whole-buffer concatenation and raw message retention", () => {
  assert.doesNotMatch(source, /Buffer\.concat\(\[this\.buffer/);
  assert.match(source, /this\.chunks\.push\(value\)/);
  assert.match(source, /return this\.consume\(length\)/);
  assert.doesNotMatch(source, /messages\.push\(\{ uid, raw,/);
});
