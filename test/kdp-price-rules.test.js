import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBookMetadata } from '../services/kdp/engine/metadataStore.ts'
import {
  analyzeKdpPriceFloors,
  kdpPriceBandForKey,
  parseKdpPriceMinorUnits,
  uk70RoyaltyFloorMinor,
  validateKdpPriceChanges,
} from '../services/kdp/engine/kdpPriceRules.ts'

function book(overrides = {}) {
  return normalizeBookMetadata({
    titleId: 'TESTTITLE01',
    format: 'kindle',
    title: 'Test ebook',
    syncedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  })
}

test('KDP 70% price rules resolve local currency and marketplace aliases', () => {
  assert.equal(kdpPriceBandForKey('GB')?.minimum, 1.77)
  assert.equal(kdpPriceBandForKey('UK')?.marketplace, 'GB')
  assert.equal(kdpPriceBandForKey('GBP')?.marketplace, 'GB')
  assert.equal(kdpPriceBandForKey('DE')?.currency, 'EUR')
  assert.equal(kdpPriceBandForKey('EUR')?.minimum, 2.69)
  assert.equal(kdpPriceBandForKey('unknown'), null)
})

test('price parsing accepts local decimal and currency formatting without guessing ambiguous values', () => {
  assert.equal(parseKdpPriceMinorUnits('£1.77'), 177)
  assert.equal(parseKdpPriceMinorUnits('2,99'), 299)
  assert.equal(parseKdpPriceMinorUnits('1.234,56'), 123456)
  assert.equal(parseKdpPriceMinorUnits('1,234'), null)
})

test('price floor audit flags below-minimum prices by marketplace and deduplicates USD aliases', () => {
  const result = analyzeKdpPriceFloors([
    book({
      listPriceUsd: '2.99',
      prices: { USD: '2.99', US: '2.50', GB: '£1.50', DE: '€2.69' },
    }),
  ])

  assert.equal(result.bookCount, 1)
  assert.equal(result.belowMinimumCount, 2)
  assert.deepEqual(
    result.issues.map((issue) => [issue.market, issue.recommendedPrice]),
    [['US', 2.99], ['GB', 1.77]],
  )
})

test('price floor audit flags above-band and unrecognised prices for review', () => {
  const result = analyzeKdpPriceFloors([
    book({ royaltyPlan: '70_PERCENT', prices: { US: '13.00', AE: '12.00', CA: 'not-a-price' } }),
  ])
  assert.equal(result.aboveMaximumCount, 1)
  assert.equal(result.unverifiedPriceCount, 2)
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ['above_70_percent_maximum', 'marketplace_price_unreadable', 'marketplace_price_unmapped'],
  )
})

test('maximum price-band limits are checked only for books on the 70% royalty plan', () => {
  const result = analyzeKdpPriceFloors([
    book({ royaltyPlan: '35_PERCENT', prices: { US: '13.00' } }),
  ])
  assert.equal(result.issueCount, 0)
})

test('price floor audit skips non-Kindle formats', () => {
  const result = analyzeKdpPriceFloors([
    book({ format: 'paperback', prices: { USD: '0.99' } }),
  ])
  assert.equal(result.bookCount, 0)
  assert.equal(result.issueCount, 0)
})

test('price changes cannot set a Kindle marketplace price below the 70% floor', () => {
  assert.match(
    validateKdpPriceChanges('kindle', { prices: { GB: '1.76' } }).join(' '),
    /GB eBook price must be at least 1\.77 GBP/,
  )
  assert.match(
    validateKdpPriceChanges('kindle', { prices: { GB: '1.77' } }).join(' '),
    /delivery file size/,
  )
  assert.deepEqual(validateKdpPriceChanges('kindle', { prices: { GB: '6.53' }, royaltyPlan: '70_PERCENT' }, undefined, '1024'), [])
  assert.deepEqual(validateKdpPriceChanges('paperback', { prices: { USD: '0.99' } }), [])
})

test('price-only updates use the cached royalty plan for 70% ceiling checks', () => {
  assert.match(
    validateKdpPriceChanges('kindle', { listPriceUsd: '13.00' }, '70_PERCENT').join(' '),
    /US eBook price cannot exceed 12\.99 USD/,
  )
  assert.deepEqual(validateKdpPriceChanges('kindle', { listPriceUsd: '13.00' }, '35_PERCENT'), [])
  assert.match(
    validateKdpPriceChanges('kindle', { listPriceUsd: '13.00' }).join(' '),
    /Cannot verify the current royalty plan/,
  )
})

test('70% plan updates also respect the marketplace upper price band', () => {
  assert.match(
    validateKdpPriceChanges('kindle', { listPriceUsd: '13.00', royaltyPlan: '70_PERCENT' }).join(' '),
    /US eBook price cannot exceed 12\.99 USD/,
  )
  assert.match(
    validateKdpPriceChanges('kindle', { prices: { AE: '12.00' } }).join(' '),
    /Cannot verify AE/,
  )
})

test('UK 70% pricing floors target at least £4.50 after KDP delivery', () => {
  assert.equal(uk70RoyaltyFloorMinor('1024'), 653)
  assert.equal(uk70RoyaltyFloorMinor('2048'), 663)
  assert.equal(uk70RoyaltyFloorMinor('3072'), 673)
  assert.equal(uk70RoyaltyFloorMinor('5120'), 693)
  assert.equal(uk70RoyaltyFloorMinor(''), null)
  assert.equal(uk70RoyaltyFloorMinor('-1'), null)
  assert.equal(uk70RoyaltyFloorMinor('1.5'), null)
  for (const [fileSizeKb, floorMinor] of [['1024', 653], ['5120', 693]]) {
    const low = ((floorMinor - 1) / 100).toFixed(2)
    assert.match(
      validateKdpPriceChanges('kindle', { prices: { UK: low }, royaltyPlan: '70_PERCENT' }, undefined, fileSizeKb).join(' '),
      /£4.50 estimated 70% royalty/,
    )
    assert.deepEqual(
      validateKdpPriceChanges('kindle', { prices: { GBP: (floorMinor / 100).toFixed(2) }, royaltyPlan: '70_PERCENT' }, undefined, fileSizeKb),
      [],
    )
  }
})

test('UK royalty target refuses unknown delivery sizes and 35% plans', () => {
  assert.match(validateKdpPriceChanges('kindle', { prices: { GBP: '6.99' } }, '70_PERCENT').join(' '), /delivery file size/)
  assert.match(validateKdpPriceChanges('kindle', { prices: { GBP: '6.99' } }, '35_PERCENT', '1024').join(' '), /requires a verified 70%/)
  assert.deepEqual(validateKdpPriceChanges('kindle', { prices: { GBP: '6.99' } }, '70_PERCENT', '1024'), [])
})

test('signed-in KDP audit reports a UK royalty shortfall or unverifiable cost', () => {
  const low = analyzeKdpPriceFloors([book({ royaltyPlan: '70_PERCENT', fileSizeKb: '1024', prices: { GB: '6.52' } })])
  assert.equal(low.belowMinimumCount, 1)
  assert.equal(low.issues[0].code, 'below_target_royalty')
  assert.equal(low.issues[0].recommendedPrice, 6.53)
  assert.equal(analyzeKdpPriceFloors([book({ royaltyPlan: '70_PERCENT', fileSizeKb: '1024', prices: { GB: '6.53' } })]).issueCount, 0)
  const unknown = analyzeKdpPriceFloors([book({ royaltyPlan: '70_PERCENT', prices: { GB: '6.99' } })])
  assert.equal(unknown.issues[0].code, 'target_royalty_unverifiable')
  assert.equal(unknown.unverifiedPriceCount, 1)
})
