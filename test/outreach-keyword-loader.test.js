import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadKeywordsFromFile,
  loadOutreachKeywords,
  parseKeywords,
  resolveKeywordFilePath,
} from "../services/outreach/utils/keywordLoader.js";

test("parseKeywords trims blank lines, commas, comments and duplicates", () => {
  assert.deepEqual(
    parseKeywords(" ai automation\n# ignore\nai automation, editorial workflows\n\nAI Automation "),
    ["ai automation", "editorial workflows"]
  );
});

test("loadOutreachKeywords prefers OUTREACH_KEYWORDS env over the keyword file", () => {
  const result = loadOutreachKeywords({
    OUTREACH_KEYWORDS: "env keyword one, env keyword two",
    OUTREACH_KEYWORDS_FILE: "missing-file.txt",
  });

  assert.equal(result.source, "env:OUTREACH_KEYWORDS");
  assert.deepEqual(result.keywords, ["env keyword one", "env keyword two"]);
});

test("loadOutreachKeywords falls back to services/outreach/keywords.txt style file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outreach-keywords-"));
  const filePath = path.join(dir, "keywords.txt");
  fs.writeFileSync(filePath, "file keyword one\nfile keyword two\n", "utf8");

  const result = loadOutreachKeywords({
    OUTREACH_KEYWORDS: "",
    OUTREACH_KEYWORDS_FILE: filePath,
  });

  assert.equal(result.source, "file");
  assert.equal(result.filePath, filePath);
  assert.equal(result.found, true);
  assert.deepEqual(result.keywords, ["file keyword one", "file keyword two"]);
});

test("loadKeywordsFromFile reports missing file diagnostics without throwing", () => {
  const filePath = path.join(os.tmpdir(), "definitely-missing-outreach-keywords.txt");
  const result = loadKeywordsFromFile(filePath);

  assert.equal(result.source, "file");
  assert.equal(result.filePath, filePath);
  assert.equal(result.found, false);
  assert.deepEqual(result.keywords, []);
});

test("resolveKeywordFilePath defaults to the repo keyword file", () => {
  assert.equal(
    resolveKeywordFilePath("services/outreach/keywords.txt"),
    path.resolve(process.cwd(), "services/outreach/keywords.txt")
  );
});
