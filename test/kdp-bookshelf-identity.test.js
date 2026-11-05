import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeRefs, collectBookshelfRefsViaBrowser } from '../services/kdp/engine/kdpMetadata.ts';

const source = fs.readFileSync(new URL('../services/kdp/engine/browser/scanBookshelf.js', import.meta.url), 'utf8');
const edit = (id, format = 'kindle') => `/action/dualbookshelf.editkindledetails/en_US/title-setup/${format}/${id}/details`;
const retail = (asin) => `/amazon-dp-action/uk/dualbookshelf.marketplacelink/${asin}`;
function scan(rowLinks) {
  const rows = rowLinks.map((hrefs) => {
    const row = { id: 'GROUPROW123', querySelectorAll: () => links };
    const links = hrefs.map((href) => ({ getAttribute: () => href, closest: () => row }));
    return { row, links };
  });
  const document = { querySelectorAll: (selector) => selector === 'a[href]' ? rows.flatMap((r) => r.links) : rows.map((r) => r.row) };
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${source})()`, { document })));
}

test('bookshelf retains the actual edit ID and its explicitly linked retail ASIN, never a grouping row ID', () => {
  const result = scan([[edit('A31ZRJGLFAETHB'), edit('A31ZRJGLFAETHB'), retail('B0DMYF3YH3')]]);
  assert.deepEqual(result.refs, [{ titleId: 'A31ZRJGLFAETHB', format: 'kindle', asin: 'B0DMYF3YH3' }]);
  assert.deepEqual(result.titleIds, ['A31ZRJGLFAETHB']);
});

test('ambiguous editions, conflicting retail links and external links cannot supply an ASIN', () => {
  for (const links of [
    [edit('A31ZRJGLFAETHB'), edit('A25YKUAYB2XJF', 'paperback'), retail('B0DMYF3YH3')],
    [edit('A31ZRJGLFAETHB'), retail('B0DMYF3YH3'), retail('B0DQHSD858')],
    [edit('A31ZRJGLFAETHB'), 'https://example.org/dp/B0DMYF3YH3'],
  ]) assert.equal(scan([links]).refs[0].asin, undefined);
  assert.deepEqual(scan([[]]).refs, []);
  assert.equal(scan([[edit('A31ZRJGLFAETHB'), retail('B0DMYF3YH3')],
    [edit('A31ZRJGLFAETHB'), retail('B0DQHSD858')]]).refs[0].asin, undefined);
});

test('normalisation retains verified associations and clears cross-page conflicts', () => {
  const base = { titleId: 'A31ZRJGLFAETHB', format: 'kindle' };
  assert.equal(normalizeRefs([{ ...base, asin: 'B0DMYF3YH3' }])[0].asin, 'B0DMYF3YH3');
  const conflicted = normalizeRefs([{ ...base, asin: 'B0DMYF3YH3' }, { ...base, asin: 'B0DQHSD858' }]);
  assert.equal(conflicted[0].asin, undefined);
  assert.equal(normalizeRefs([...conflicted, { ...base, asin: 'B0DQHSD858' }])[0].asin, undefined);
});

function paginatedPage(size) {
  const page = { index: 0, url: () => 'https://kdp.amazon.com/en_US/bookshelf',
    locator: () => ({ first: () => ({ count: async () => page.index < size - 1 ? 1 : 0, click: async () => { page.index++; } }) }),
    waitForFunction: async () => {}, waitForLoadState: async () => {},
  };
  return page;
}
const pageScan = (index) => ({ bookshelfRows: 1, titleIds: [`A1234567890${index}`],
  refs: [{ titleId: `A1234567890${index}`, format: 'kindle', asin: `B01234567${index}` }] });

test('bookshelf follows next controls beyond the initial page-number range', async () => {
  const result = await collectBookshelfRefsViaBrowser(paginatedPage(9), {
    scanPage: async (p) => pageScan(p.index), navigate: async () => {}, throttle: async () => {},
  });
  assert.equal(result.pagesScanned, 9);
  assert.equal(result.refs.length, 9);
  assert.equal(result.refs[8].asin, 'B012345678');
});

test('a stuck bookshelf page fails rather than replacing the cache with a partial scan', async () => {
  await assert.rejects(collectBookshelfRefsViaBrowser(paginatedPage(2), {
    scanPage: async () => pageScan(0), navigate: async () => {}, throttle: async () => {},
  }), /pagination did not advance/);
});
