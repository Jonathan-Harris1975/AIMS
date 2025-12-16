import path from "path";
import { getObjectAsText, putJson } from "#shared/r2-client.js";
import { serpOutreach } from "./serp-OutreachService.js";
import { extractGoodLeads } from "../utils/filters.js";
import { appendLeadRows } from "./sheetService.js";
import fs from "fs";

const PROGRESS_KEY = process.env.OUTREACH_PROGRESS_KEY || "outreach/progress.json";
const BATCH_SIZE = Number(process.env.OUTREACH_BATCH_SIZE || "50");
const RATE_DELAY = Number(process.env.SERP_RATE_DELAY_MS || "1500");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function keywordsPath() {
  return process.env.OUTREACH_KEYWORDS_FILE || path.join("services", "outreach", "keywords.txt");
}

function loadKeywords(file) {
  const p = path.resolve(process.cwd(), file);
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

export async function getProgress() {
  try {
    const txt = await getObjectAsText("meta", PROGRESS_KEY);
    const p = JSON.parse(txt);
    return {
      batchSize: BATCH_SIZE,
      lastProcessedIndex: Number(p.lastProcessedIndex || 0),
      updatedAt: p.updatedAt || null
    };
  } catch {
    return { batchSize: BATCH_SIZE, lastProcessedIndex: 0, updatedAt: null };
  }
}

async function saveProgress(lastProcessedIndex) {
  const payload = { lastProcessedIndex, updatedAt: new Date().toISOString() };
  await putJson("meta", PROGRESS_KEY, payload);
  return payload;
}

export async function resetProgress(lastProcessedIndex = 0) {
  return saveProgress(Number(lastProcessedIndex) || 0);
}

export async function runNextBatch() {
  const kws = loadKeywords(keywordsPath());
  const prog = await getProgress();

  const start = prog.lastProcessedIndex;
  const end = Math.min(start + BATCH_SIZE, kws.length);
  const slice = kws.slice(start, end);

  if (!slice.length) {
    return { done: true, batchStart: start, batchEnd: start, nextIndex: start, processed: 0 };
  }

  let totalLeads = 0;
  let keywordsWithLeads = 0;

  for (let i = 0; i < slice.length; i++) {
    const kw = slice[i];

    const result = await serpOutreach(kw);
    const good = extractGoodLeads(result, kw);

    if (good.length) {
      const rows = good.map((r) => [
        r.timestamp,
        r.keyword,
        r.domain,
        r.da,
        r.serpPosition ?? r.serpPos ?? null,
        r.email,
        r.emailScore,
        r.leadScore
      ]);

      await appendLeadRows(rows);
      totalLeads += good.length;
      keywordsWithLeads += 1;
    }

    await wait(RATE_DELAY);
  }

  const nextIndex = start + slice.length;
  await saveProgress(nextIndex);

  return {
    done: false,
    batchStart: start,
    batchEnd: end,
    processed: slice.length,
    nextIndex,
    totalLeads,
    keywordsWithLeads
  };
}
