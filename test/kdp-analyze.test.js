import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeBookMetadata } from '../services/kdp/engine/kdpAnalyze.ts'
import { normalizeBookMetadata } from '../services/kdp/engine/metadataStore.ts'

function book(overrides = {}) {
  return normalizeBookMetadata({
    titleId: 'TESTTITLE01',
    format: 'kindle',
    title: 'Test ebook',
    syncedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  })
}

test('KDP metadata analysis treats unused keyword slots as optional and short copy as editorial review', () => {
  const result = analyzeBookMetadata([
    book({ keywords: ['specific reader phrase', 'book topic'] }),
    book({ titleId: 'TESTTITLE02', keywords: [], description: 'A short accurate description.' }),
  ])

  assert.equal(result.summary.emptyKeywords, 1)
  assert.equal(result.summary.shortDescriptions, 2)
  assert.equal(result.issues.some((issue) => issue.field === 'keywords' && issue.message.includes('Only 2/7')), false)
  assert.equal(result.issues.some((issue) => issue.field === 'description' && issue.severity === 'error'), false)
})
