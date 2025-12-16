import fs from 'fs';
import path from 'path';
export function loadKeywordsFromFile(fp='keywords.txt'){
 return fs.readFileSync(path.resolve(process.cwd(),fp),'utf8')
 .split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}