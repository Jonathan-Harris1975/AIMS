import { readFile } from "node:fs/promises";
import { benchmarkArtworkModels } from "../services/artwork/utils/artwork.js";

const [file, confirmation] = process.argv.slice(2);
if (!file || confirmation !== "--run-paid") throw new Error("Usage: node scripts/benchmarkArtwork.js briefs.json --run-paid");
const briefs = JSON.parse(await readFile(file, "utf8"));
const result = await benchmarkArtworkModels({ briefs, confirmPaid: true });
console.log(JSON.stringify(result, null, 2));
