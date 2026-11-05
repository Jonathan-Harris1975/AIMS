import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import { KdpAuthError, KdpClientError } from './kdpClient.ts'
import { fetchAndParseKdpHtml, kdpFetchHtml, parseKdpHtml } from './kdpHtmlParse.ts'
import { kdpGoto } from './kdpHttp.ts'
import { fetchAccountCatalogSize, fetchReportsBooksMetadata } from './kdpReportsApi.ts'
import { kdpThrottle } from './kdpRateLimit.ts'
import {
  type KdpBookFormat,
  type KdpBookMetadata,
  type KdpMetadataCache,
  type KdpMetadataSyncStats,
  METADATA_CACHE_VERSION,
  writeMetadataCache,
} from './metadataStore.ts'
import { withKdpBrowserContext } from './browser.ts'

const BOOKSHELF_URL = 'https://kdp.amazon.com/en_US/bookshelf'

const PARSE_DETAILS_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), './browser/parseBookDetails.js'),
  'utf8',
)

const PARSE_CONTENT_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), './browser/parseBookContent.js'),
  'utf8',
)

const PARSE_PRICING_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), './browser/parseBookPricing.js'),
  'utf8',
)

const SCAN_BOOKSHELF_FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), './browser/scanBookshelf.js'),
  'utf8',
)

const FORMAT_ORDER: KdpBookFormat[] = ['kindle', 'paperback', 'hardcover']

type ParsedDetails = {
  title: string
  subtitle: string
  description: string
  language: string
  primaryAuthorFirstName: string
  primaryAuthorLastName: string
  publisherLabel: string
  editionNumber: string
  seriesTitle: string
  seriesNumber: string
  homeMarketplace: string
  readingInterestAgeMin: string
  readingInterestAgeMax: string
  publishingStatus: string
  isPublicDomain: boolean
  isAdultContent: boolean
  largePrint: boolean
  keywords: string[]
  categories: string[]
  contributors: Array<{ role: string; firstName: string; lastName: string }>
}

type ParsedContent = {
  isbn: string
  imprint: string
  trimSize: string
  inkAndPaper: string
  interiorFileName: string
  coverFileName: string
  pageCount: string
  manuscriptStatus: string
  coverStatus: string
}

type ParsedPricing = {
  asin: string
  listPriceUsd: string
  prices: Record<string, string>
  territory: string
  royaltyPlan: string
  fileSizeKb: string
  kdpSelect: boolean
}

type TitleFormatRef = {
  titleId: string
  format: KdpBookFormat
  asin?: string
  title?: string
}

type BookshelfPageScan = {
  bookshelfRows: number
  titleIds: string[]
  refs: Array<{ titleId: string; format: string; asin?: string }>
}

type BookshelfScan = {
  refs: TitleFormatRef[]
  bookshelfRows: number
  uniqueTitleIds: number
  pagesScanned: number
}

export type KdpBrowserOptions = {
  /** Default true. Set false for content uploads (KDP often rejects headless file uploads). */
  headless?: boolean
  viewport?: { width: number; height: number }
}

export async function withKdpPage<T>(
  fn: (page: Page) => Promise<T>,
  options: KdpBrowserOptions = {},
): Promise<T> {
  return withKdpPages(async ({ action }) => fn(action), options)
}

/** Separate pages avoid setContent/HTML parse conflicting with live navigation. */
export async function withKdpPages<T>(
  fn: (pages: { action: Page; parse: Page }) => Promise<T>,
  options: KdpBrowserOptions = {},
): Promise<T> {
  return withKdpBrowserContext(async (context) => {
    const action = await context.newPage()
    const parse = await context.newPage()
    return await fn({ action, parse })
  }, { headless: options.headless ?? true, viewport: options.viewport ?? { width: 1920, height: 1080 } })
}

async function scanCurrentBookshelfPage(page: Page): Promise<BookshelfPageScan> {
  return page.evaluate(`(${SCAN_BOOKSHELF_FN})()`) as Promise<BookshelfPageScan>
}

async function scanBookshelfHtml(page: Page, html: string): Promise<BookshelfPageScan> {
  return parseKdpHtml<BookshelfPageScan>(page, html, SCAN_BOOKSHELF_FN)
}

async function collectBookshelfRefsFromReportsApi(
  page: Page,
): Promise<TitleFormatRef[] | null> {
  const refs = await fetchReportsBooksMetadata(page)
  if (refs.length === 0) return null
  return refs.map((r) => ({ titleId: r.titleId, format: r.format, asin: r.asin, title: r.title }))
}

/** Never substitute an internal title ID for the retail ASIN. */
export function verifiedRefAsin(pricingAsin: string, reportAsin?: string): string {
  const pricing = pricingAsin.trim().toUpperCase()
  const report = (reportAsin || '').trim().toUpperCase()
  const valid = (value: string) => /^B0[A-Z0-9]{8}$/.test(value)
  if (valid(pricing) && valid(report) && pricing !== report) return ''
  if (valid(pricing)) return pricing
  return valid(report) ? report : ''
}

async function collectBookshelfRefsFromHtml(
  actionPage: Page,
  parsePage: Page,
): Promise<BookshelfScan | null> {
  const fetched = await kdpFetchHtml(actionPage, BOOKSHELF_URL)
  if (!fetched.ok) {
    if (fetched.reason === 'auth') throw new KdpAuthError()
    return null
  }

  const scan = await scanBookshelfHtml(parsePage, fetched.html)
  const refMap = new Map<string, TitleFormatRef>()
  const titleIdSet = new Set(scan.titleIds)

  for (const ref of normalizeRefs(scan.refs)) {
    refMap.set(`${ref.titleId}:${ref.format}`, ref)
  }
  for (const id of scan.titleIds) {
    titleIdSet.add(id)
  }


  return {
    refs: [...refMap.values()],
    bookshelfRows: scan.bookshelfRows,
    uniqueTitleIds: titleIdSet.size,
    pagesScanned: 1,
  }
}

async function collectBookshelfRefs(
  actionPage: Page,
  parsePage: Page,
): Promise<BookshelfScan> {
  const apiRefs = await collectBookshelfRefsFromReportsApi(actionPage)
  if (apiRefs && apiRefs.length > 0) {
    return {
      refs: apiRefs.sort((a, b) => {
        const titleCmp = a.titleId.localeCompare(b.titleId)
        if (titleCmp !== 0) return titleCmp
        return FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
      }),
      bookshelfRows: apiRefs.length,
      uniqueTitleIds: new Set(apiRefs.map((r) => r.titleId)).size,
      pagesScanned: 0,
    }
  }

  const htmlScan = await collectBookshelfRefsFromHtml(actionPage, parsePage)
  if (htmlScan && htmlScan.refs.length > 0) {
    const catalogSize = await fetchAccountCatalogSize(actionPage)
    const looksComplete =
      catalogSize == null || htmlScan.uniqueTitleIds >= catalogSize * 0.9
    if (looksComplete) {
      return htmlScan
    }
  }

  return collectBookshelfRefsViaBrowser(actionPage)
}

/** Paginated Bookshelf scrape — fallback when API/HTML fetch do not return refs. */
export async function collectBookshelfRefsViaBrowser(page: Page, {
  scanPage = scanCurrentBookshelfPage, navigate = kdpGoto, throttle = kdpThrottle,
} = {}): Promise<BookshelfScan> {
  await navigate(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()

  let refs: TitleFormatRef[] = []
  let totalRows = 0
  const seen = new Set<string>()
  for (let pagesScanned = 1; pagesScanned <= 200; pagesScanned++) {
    const scan = await scanPage(page)
    const signature = scan.refs.map((r) => `${r.titleId}:${r.format}`).sort().join(',')
    if (!signature || seen.has(signature)) throw new KdpClientError('KDP Bookshelf pagination did not advance; refusing an incomplete snapshot.')
    seen.add(signature)
    totalRows += scan.bookshelfRows
    refs = normalizeRefs([...refs, ...scan.refs])
    const next = page.locator('.a-pagination li.a-last:not(.a-disabled) a').first()
    if (await next.count() === 0) {
      return { refs, bookshelfRows: totalRows, uniqueTitleIds: new Set(refs.map((r) => r.titleId)).size, pagesScanned }
    }
    if (pagesScanned === 200) throw new KdpClientError('KDP Bookshelf exceeded the pagination limit.')
    await throttle()
    await next.click({ timeout: 15_000 })
    await page.waitForFunction(`(previous) => {
      const scan = (${SCAN_BOOKSHELF_FN})()
      return scan.refs.map((r) => r.titleId + ':' + r.format).sort().join(',') !== previous
    }`, signature, { timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
  }
  throw new KdpClientError('KDP Bookshelf scan did not complete.')
}

export function normalizeRefs(raw: Array<{ titleId: string; format: string; asin?: string }>): TitleFormatRef[] {
  const map = new Map<string, TitleFormatRef>()
  const conflicts = new Set<string>()
  for (const ref of raw) {
    const format = ref.format as KdpBookFormat
    if (format !== 'kindle' && format !== 'paperback' && format !== 'hardcover') {
      continue
    }
    const key = `${ref.titleId}:${format}`
    const existing = map.get(key)
    const asin = verifiedRefAsin('', ref.asin)
    if (existing?.asin && asin && existing.asin !== asin) conflicts.add(key)
    map.set(key, { titleId: ref.titleId, format, asin: asin || existing?.asin })
  }
  return [...map.entries()].map(([key, ref]) => conflicts.has(key) ? { ...ref, asin: undefined } : ref).sort((a, b) => {
    const titleCmp = a.titleId.localeCompare(b.titleId)
    if (titleCmp !== 0) return titleCmp
    return FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
  })
}

export function setupPageUrl(
  format: KdpBookFormat,
  titleId: string,
  step: 'details' | 'content' | 'pricing',
): string {
  const setupPath =
    format === 'paperback' && step === 'pricing' ? 'print-setup' : 'title-setup'
  return `https://kdp.amazon.com/en_US/${setupPath}/${format}/${titleId}/${step}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchBookMetadata(
  requestPage: Page,
  parsePage: Page,
  ref: TitleFormatRef,
): Promise<KdpBookMetadata | null> {
  const details = await fetchAndParseKdpHtml<ParsedDetails>(
    requestPage,
    parsePage,
    setupPageUrl(ref.format, ref.titleId, 'details'),
    PARSE_DETAILS_FN,
  )
  if (!details) {
    return null
  }

  const description = stripHtml(details.description)
  const hasContent =
    Boolean(details.title.trim()) ||
    Boolean(details.subtitle.trim()) ||
    Boolean(description) ||
    details.keywords.length > 0 ||
    details.categories.length > 0 ||
    Boolean(details.primaryAuthorFirstName.trim()) ||
    Boolean(details.primaryAuthorLastName.trim())

  if (!hasContent) {
    return null
  }

  let content: ParsedContent = {
    isbn: '',
    imprint: '',
    trimSize: '',
    inkAndPaper: '',
    interiorFileName: '',
    coverFileName: '',
    pageCount: '',
    manuscriptStatus: '',
    coverStatus: '',
  }
  const parsedContent = await fetchAndParseKdpHtml<ParsedContent>(
    requestPage,
    parsePage,
    setupPageUrl(ref.format, ref.titleId, 'content'),
    PARSE_CONTENT_FN,
  )
  if (parsedContent) {
    content = parsedContent
  }

  let pricing: ParsedPricing = {
    asin: '',
    listPriceUsd: '',
    prices: {},
    territory: '',
    royaltyPlan: '',
    fileSizeKb: '',
    kdpSelect: false,
  }
  const parsedPricing = await fetchAndParseKdpHtml<ParsedPricing>(
    requestPage,
    parsePage,
    setupPageUrl(ref.format, ref.titleId, 'pricing'),
    PARSE_PRICING_FN,
  )
  if (parsedPricing) {
    pricing = parsedPricing
  }

  return {
    titleId: ref.titleId,
    format: ref.format,
    title: details.title.trim() || '(untitled)',
    subtitle: details.subtitle.trim(),
    description,
    language: details.language,
    publishingStatus: details.publishingStatus,
    primaryAuthor: {
      firstName: details.primaryAuthorFirstName,
      lastName: details.primaryAuthorLastName,
    },
    contributors: details.contributors,
    publisherLabel: details.publisherLabel,
    editionNumber: details.editionNumber,
    seriesTitle: details.seriesTitle,
    seriesNumber: details.seriesNumber,
    categories: details.categories,
    keywords: details.keywords,
    readingInterestAgeMin: details.readingInterestAgeMin,
    readingInterestAgeMax: details.readingInterestAgeMax,
    homeMarketplace: details.homeMarketplace,
    isPublicDomain: details.isPublicDomain,
    isAdultContent: details.isAdultContent,
    largePrint: details.largePrint,
    isbn: content.isbn,
    imprint: content.imprint,
    trimSize: content.trimSize,
    inkAndPaper: content.inkAndPaper,
    interiorFileName: content.interiorFileName,
    coverFileName: content.coverFileName,
    pageCount: content.pageCount,
    manuscriptStatus: content.manuscriptStatus,
    coverStatus: content.coverStatus,
    asin: verifiedRefAsin(pricing.asin, ref.asin),
    listPriceUsd: pricing.listPriceUsd,
    prices: pricing.prices,
    territory: pricing.territory,
    royaltyPlan: pricing.royaltyPlan,
    fileSizeKb: pricing.fileSizeKb,
    kdpSelect: pricing.kdpSelect,
    syncedAt: new Date().toISOString(),
  }
}

export async function syncAllBookMetadata(): Promise<KdpMetadataCache> {
  return withKdpPages(async ({ action, parse }) => {
    const scan = await collectBookshelfRefs(action, parse)
    return syncBooksFromRefs(action, parse, scan)
  })
}

export type BookshelfListItem = {
  titleId: string
  format: KdpBookFormat
  title?: string
  asin?: string
}

export type BookshelfListResult = {
  refs: BookshelfListItem[]
  bookshelfRows: number
  uniqueTitleIds: number
  pagesScanned: number
}

/** Fast Bookshelf scan — title/format refs only, no per-book metadata fetch. */
export async function listBookshelf(): Promise<BookshelfListResult> {
  return withKdpPages(async ({ action, parse }) => {
    const scan = await collectBookshelfRefs(action, parse)
    return {
      refs: scan.refs,
      bookshelfRows: scan.bookshelfRows,
      uniqueTitleIds: scan.uniqueTitleIds,
      pagesScanned: scan.pagesScanned,
    }
  })
}

/** Refresh metadata for a single title/format and patch the local cache. */
export async function syncBookMetadata(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpBookMetadata> {
  return withKdpPages(async ({ action, parse }) => {
    const scan = await collectBookshelfRefs(action, parse)
    const ref = scan.refs.find((candidate) => candidate.titleId === titleId && candidate.format === format)
    if (!ref) throw new KdpClientError(`KDP Bookshelf has no exact ${format} record for ${titleId}.`)
    const meta = await fetchBookMetadata(action, parse, ref)
    if (!meta) {
      throw new KdpClientError(
        `Could not read metadata for ${titleId} (${format}).`,
      )
    }
    const { patchBookInCache } = await import('./metadataStore.ts')
    return patchBookInCache(meta)
  })
}

async function syncBooksFromRefs(
  action: Page,
  parse: Page,
  scan: BookshelfScan,
): Promise<KdpMetadataCache> {
  const refs = scan.refs

  if (refs.length === 0) {
    throw new KdpClientError(
      'No titles found on your KDP Bookshelf. Check that your account has published or in-setup books.',
    )
  }

  const books: KdpBookMetadata[] = []
  let skippedCount = 0

  for (const ref of refs) {
    const meta = await fetchBookMetadata(action, parse, ref)
    if (meta) {
      books.push(meta)
    } else {
      skippedCount += 1
    }
  }

  if (books.length === 0) {
    throw new KdpClientError('Could not read metadata from any Bookshelf title.')
  }

  books.sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title)
    if (titleCmp !== 0) return titleCmp
    return FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
  })

  const stats: KdpMetadataSyncStats = {
    bookshelfRows: scan.bookshelfRows,
    uniqueTitleIds: scan.uniqueTitleIds,
    pagesScanned: scan.pagesScanned,
    discoveredRefs: refs.length,
    syncedCount: books.length,
    skippedCount,
  }

  const cache: KdpMetadataCache = {
    cacheVersion: METADATA_CACHE_VERSION,
    syncedAt: new Date().toISOString(),
    books,
    stats,
  }
  await writeMetadataCache(cache)
  return cache
}
