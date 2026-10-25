import test from 'node:test'
import assert from 'node:assert/strict'
import { pricingApplied } from '../services/kdp/engine/kdpPricingUpdate.ts'
import { normalizeBookMetadata } from '../services/kdp/engine/metadataStore.ts'

function book(overrides = {}) {
  return normalizeBookMetadata({
    titleId: 'test-title',
    format: 'kindle',
    title: 'Test title',
    syncedAt: new Date().toISOString(),
    ...overrides,
  })
}

test('KDP pricing verification requires persisted values for every requested field', () => {
  const requested = {
    listPriceUsd: '4.99',
    prices: { US: '4.99', GB: '1.77' },
    territory: 'worldwide',
    royaltyPlan: '70_PERCENT',
    kdpSelect: true,
  }

  assert.equal(
    pricingApplied(
      book({
        listPriceUsd: '4.99',
        prices: { US: '4.99', GB: '1.77' },
        territory: 'worldwide',
        royaltyPlan: '70_PERCENT',
        kdpSelect: true,
      }),
      requested,
    ),
    true,
  )

  for (const field of ['listPriceUsd', 'territory', 'royaltyPlan', 'kdpSelect']) {
    const persisted = {
      listPriceUsd: '4.99',
      prices: { US: '4.99', GB: '1.77' },
      territory: 'worldwide',
      royaltyPlan: '70_PERCENT',
      kdpSelect: true,
    }
    persisted[field] = field === 'kdpSelect' ? false : 'not-saved'
    assert.equal(
      pricingApplied(book(persisted), requested),
      false,
      `must reject a persisted mismatch for ${field}`,
    )
  }

  assert.equal(
    pricingApplied(
      book({
        listPriceUsd: '4.99',
        prices: { US: '4.99', GB: '1.50' },
        territory: 'worldwide',
        royaltyPlan: '70_PERCENT',
        kdpSelect: true,
      }),
      requested,
    ),
    false,
    'must reject an unsaved price in any requested marketplace',
  )
})

test('KDP pricing verification prefers exact storefront values and matches legacy UK aliases', () => {
  assert.equal(
    pricingApplied(
      book({ prices: { USD: '4.99', US: '3.99' } }),
      { prices: { US: '4.99' } },
    ),
    false,
  )
  assert.equal(
    pricingApplied(
      book({ prices: { UK: '1.77' } }),
      { prices: { GBP: '1.77' } },
    ),
    true,
  )
})
