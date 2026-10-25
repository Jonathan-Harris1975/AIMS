import type { KdpBookMetadata } from './metadataStore.ts'

/**
 * Official KDP 70% eBook price bands, reviewed against the KDP help page on
 * 2026-10-25. Refresh these rules when Amazon changes its published bands.
 */
export const KDP_PRICE_RULES_REVIEWED_AT = '2026-10-25'
export const KDP_PRICE_RULES_SOURCE = 'https://kdp.amazon.com/en_US/help/topic/G200634560'

export type KdpPriceBand = {
  marketplace: string
  currency: string
  minimum: number
  maximum: number
}

const MARKET_BANDS: Record<string, KdpPriceBand> = {
  US: { marketplace: 'US', currency: 'USD', minimum: 2.99, maximum: 12.99 },
  GB: { marketplace: 'GB', currency: 'GBP', minimum: 1.77, maximum: 12.99 },
  CA: { marketplace: 'CA', currency: 'CAD', minimum: 2.99, maximum: 12.99 },
  BR: { marketplace: 'BR', currency: 'BRL', minimum: 5.99, maximum: 31.99 },
  IN: { marketplace: 'IN', currency: 'INR', minimum: 99, maximum: 599 },
  JP: { marketplace: 'JP', currency: 'JPY', minimum: 250, maximum: 1650 },
  MX: { marketplace: 'MX', currency: 'MXN', minimum: 34.99, maximum: 199.99 },
  AU: { marketplace: 'AU', currency: 'AUD', minimum: 3.99, maximum: 15.99 },
  DE: { marketplace: 'DE', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  FR: { marketplace: 'FR', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  ES: { marketplace: 'ES', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  IT: { marketplace: 'IT', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  NL: { marketplace: 'NL', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  BE: { marketplace: 'BE', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  IE: { marketplace: 'IE', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  AT: { marketplace: 'AT', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  LU: { marketplace: 'LU', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  PT: { marketplace: 'PT', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  FI: { marketplace: 'FI', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  GR: { marketplace: 'GR', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  EE: { marketplace: 'EE', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  LV: { marketplace: 'LV', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  LT: { marketplace: 'LT', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  SI: { marketplace: 'SI', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  SK: { marketplace: 'SK', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  MT: { marketplace: 'MT', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
  CY: { marketplace: 'CY', currency: 'EUR', minimum: 2.69, maximum: 12.99 },
}

const CURRENCY_MARKET: Record<string, string> = {
  USD: 'US', GBP: 'GB', CAD: 'CA', BRL: 'BR', INR: 'IN',
  JPY: 'JP', MXN: 'MX', AUD: 'AU', EUR: 'DE',
}

export type KdpPriceFloorIssue = {
  titleId: string
  format: string
  title: string
  market: string
  currency: string | null
  listPrice: string
  minimum: number | null
  maximum: number | null
  severity: 'error' | 'warning'
  code: 'below_70_percent_minimum' | 'above_70_percent_maximum' | 'marketplace_price_unreadable' | 'marketplace_price_unmapped'
  recommendedPrice: number | null
  message: string
}

export type KdpPriceFloorAnalysis = {
  rulesReviewedAt: string
  rulesSource: string
  bookCount: number
  issueCount: number
  belowMinimumCount: number
  aboveMaximumCount: number
  unverifiedPriceCount: number
  issues: KdpPriceFloorIssue[]
}

/** Parse a KDP list-price field into integer minor units; reject ambiguous data. */
export function parseKdpPriceMinorUnits(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null
  }

  let value = raw.trim().replace(/[^\d.,-]/g, '')
  if (!value || !/^-?[\d.,]+$/.test(value)) return null
  if (value.includes(',') && value.includes('.')) {
    const decimalSeparator = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.'
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    value = value.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.')
  } else {
    value = value.replace(',', '.')
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
}

/** Resolve a KDP currency key (USD/GBP/EUR) or storefront code (US/GB/DE). */
export function kdpPriceBandForKey(key: string): KdpPriceBand | null {
  const normalized = key.trim().toUpperCase()
  const market = MARKET_BANDS[normalized] ? normalized : CURRENCY_MARKET[normalized]
  return market ? MARKET_BANDS[market] : null
}

export function validateKdpPriceChanges(
  format: KdpBookMetadata['format'],
  changes: { listPriceUsd?: string; prices?: Record<string, string>; royaltyPlan?: string },
): string[] {
  if (format !== 'kindle') return []
  const errors: string[] = []
  const proposed = Object.entries(changes.prices || {})
  if (changes.listPriceUsd !== undefined) proposed.push(['USD', changes.listPriceUsd])
  const require70Maximum = /70/.test(String(changes.royaltyPlan || ''))

  for (const [key, raw] of proposed) {
    const band = kdpPriceBandForKey(key)
    if (!band) {
      errors.push(`Cannot verify ${key.toUpperCase()} against KDP's 70% eBook price band; refusing the price update.`)
      continue
    }
    const value = parseKdpPriceMinorUnits(raw)
    if (value === null) {
      errors.push(`Cannot safely parse the ${band.marketplace} eBook price; refusing the price update.`)
      continue
    }
    if (value < Math.round(band.minimum * 100)) {
      errors.push(`${band.marketplace} eBook price must be at least ${band.minimum} ${band.currency} for the 70% royalty price band.`)
    }
    if (require70Maximum && value > Math.round(band.maximum * 100)) {
      errors.push(`${band.marketplace} eBook price cannot exceed ${band.maximum} ${band.currency} while selecting the 70% royalty option.`)
    }
  }
  return errors
}

function analyzePriceEntry(
  book: KdpBookMetadata,
  key: string,
  value: string,
  enforceMaximum: boolean,
): KdpPriceFloorIssue | null {
  const band = kdpPriceBandForKey(key)
  if (!band) {
    return {
      titleId: book.titleId,
      format: book.format,
      title: book.title,
      market: key.toUpperCase(),
      currency: null,
      listPrice: value,
      minimum: null,
      maximum: null,
      severity: 'warning',
      code: 'marketplace_price_unmapped',
      recommendedPrice: null,
      message: `No 70% price rule is configured for marketplace/currency ${key.toUpperCase()}; review it manually.`,
    }
  }

  const actual = parseKdpPriceMinorUnits(value)
  if (actual === null) {
    return {
      titleId: book.titleId,
      format: book.format,
      title: book.title,
      market: band.marketplace,
      currency: band.currency,
      listPrice: value,
      minimum: band.minimum,
      maximum: band.maximum,
      severity: 'warning',
      code: 'marketplace_price_unreadable',
      recommendedPrice: null,
      message: `Could not safely parse the ${band.marketplace} list price; review it manually.`,
    }
  }

  const minimum = Math.round(band.minimum * 100)
  const maximum = Math.round(band.maximum * 100)
  if (actual < minimum) {
    return {
      titleId: book.titleId,
      format: book.format,
      title: book.title,
      market: band.marketplace,
      currency: band.currency,
      listPrice: value,
      minimum: band.minimum,
      maximum: band.maximum,
      severity: 'error',
      code: 'below_70_percent_minimum',
      recommendedPrice: band.minimum,
      message: `${band.marketplace} list price is below the 70% royalty minimum of ${band.minimum} ${band.currency}.`,
    }
  }
  if (enforceMaximum && actual > maximum) {
    return {
      titleId: book.titleId,
      format: book.format,
      title: book.title,
      market: band.marketplace,
      currency: band.currency,
      listPrice: value,
      minimum: band.minimum,
      maximum: band.maximum,
      severity: 'error',
      code: 'above_70_percent_maximum',
      recommendedPrice: band.maximum,
      message: `${band.marketplace} list price is above the 70% royalty maximum of ${band.maximum} ${band.currency}.`,
    }
  }
  return null
}

export function analyzeKdpPriceFloors(books: KdpBookMetadata[]): KdpPriceFloorAnalysis {
  const issues: KdpPriceFloorIssue[] = []
  for (const book of books) {
    if (book.format !== 'kindle') continue
    const entries = Object.entries(book.prices || {}).filter(([, value]) => String(value ?? '').trim())
    if (book.listPriceUsd.trim() && !entries.some(([key]) => ['USD', 'US'].includes(key.toUpperCase()))) {
      entries.push(['USD', book.listPriceUsd])
    }

    entries.sort(([left], [right]) => {
      const leftBand = kdpPriceBandForKey(left)
      const rightBand = kdpPriceBandForKey(right)
      const leftIsStorefront = leftBand?.marketplace === left.toUpperCase()
      const rightIsStorefront = rightBand?.marketplace === right.toUpperCase()
      return Number(rightIsStorefront) - Number(leftIsStorefront)
    })

    // The parser can expose both the USD input and US storefront field. Treat
    // those as one price so a single violation is reported once.
    const seenMarkets = new Set<string>()
    for (const [key, rawValue] of entries) {
      const band = kdpPriceBandForKey(key)
      const marketKey = band?.marketplace ?? key.toUpperCase()
      if (seenMarkets.has(marketKey)) continue
      seenMarkets.add(marketKey)
      const enforceMaximum = /70/.test(String(book.royaltyPlan || ''))
      const issue = analyzePriceEntry(book, key, String(rawValue), enforceMaximum)
      if (issue) issues.push(issue)
    }
  }

  return {
    rulesReviewedAt: KDP_PRICE_RULES_REVIEWED_AT,
    rulesSource: KDP_PRICE_RULES_SOURCE,
    bookCount: books.filter((book) => book.format === 'kindle').length,
    issueCount: issues.length,
    belowMinimumCount: issues.filter((issue) => issue.code === 'below_70_percent_minimum').length,
    aboveMaximumCount: issues.filter((issue) => issue.code === 'above_70_percent_maximum').length,
    unverifiedPriceCount: issues.filter((issue) => issue.code === 'marketplace_price_unmapped' || issue.code === 'marketplace_price_unreadable').length,
    issues,
  }
}

export const __kdpPriceRuleTestHooks = { MARKET_BANDS, CURRENCY_MARKET, analyzePriceEntry }
