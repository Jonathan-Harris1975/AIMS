import { readFile } from "node:fs/promises";
import { evaluateCouncilShadow } from "../services/newsletter/engine/evaluateCouncilShadow.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/evaluateNewsletterCouncilShadow.js comparisons.jsonl");
const source = await readFile(path, "utf8");
const rows = source.trim().startsWith("[") ? JSON.parse(source) : source.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
if (!Array.isArray(rows)) throw new Error("Expected a JSON array or JSONL comparison rows");
process.stdout.write(`${JSON.stringify(evaluateCouncilShadow(rows), null, 2)}\n`);
