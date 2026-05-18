import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTREACH_KEYWORDS_FILE = "services/outreach/keywords.txt";

function normalise(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function parseKeywords(raw) {
  if (!raw) return [];

  const seen = new Set();

  return String(raw)
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("#"))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function resolveKeywordFilePath(filePath = process.env.OUTREACH_KEYWORDS_FILE) {
  const requested = normalise(filePath) || DEFAULT_OUTREACH_KEYWORDS_FILE;
  return path.isAbsolute(requested) ? requested : path.resolve(process.cwd(), requested);
}

export function loadKeywordsFromFile(filePath = process.env.OUTREACH_KEYWORDS_FILE) {
  const resolvedPath = resolveKeywordFilePath(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      keywords: [],
      source: "file",
      filePath: resolvedPath,
      found: false,
    };
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");

  return {
    keywords: parseKeywords(raw),
    source: "file",
    filePath: resolvedPath,
    found: true,
  };
}

export function loadOutreachKeywords(env = process.env) {
  const envKeywords = parseKeywords(env.OUTREACH_KEYWORDS);

  if (envKeywords.length) {
    return {
      keywords: envKeywords,
      source: "env:OUTREACH_KEYWORDS",
      filePath: null,
      found: true,
    };
  }

  return loadKeywordsFromFile(env.OUTREACH_KEYWORDS_FILE);
}
