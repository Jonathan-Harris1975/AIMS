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
  asinConflict?: boolean
  title?: string
}

type BookshelfPageScan = {
  bookshelfRows: number
  titleIds: string[]
  refs: Array<{ titleId: string; format: string; asin?: string; asinConflict?: boolean }>
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

export function requireFreshPricingAsin(pricingAsin: string, expectedAsin: string): string {
  const observed = verifiedRefAsin(pricingAsin)
  const expected = verifiedRefAsin(expectedAsin)
  if (!observed || !expected || observed !== expected) {
    throw new KdpClientError('The authenticated KDP pricing page did not independently confirm the expected ASIN.')
  }
  return observed
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
      catalogSize != null && htmlScan.uniqueTitleIds >= catalogSize
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
    // Prefer a verified same-origin Bookshelf page URL when KDP exposes one:
    // clicking its JS paginator can leave the rendered rows unchanged and hang.
    // Never follow an unrelated action, domain, or javascript: URL.
    const currentUrl = page.url()
    const href = typeof next.getAttribute === 'function'
      ? await next.getAttribute('href') : null
    let nextUrl: URL | null = null
    if (href) {
      try {
        const candidate = new URL(href, currentUrl)
        const previous = new URL(currentUrl)
        if (candidate.protocol === 'https:' && candidate.origin === previous.origin &&
            candidate.pathname === previous.pathname && candidate.href !== previous.href) {
          nextUrl = candidate
        }
      } catch { /* Malformed pagination links are handled by a normal click. */ }
    }
    if (nextUrl) {
      await navigate(page, nextUrl.href, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    } else {
      await next.click({ timeout: 15_000 })
    }
    try {
      await page.waitForFunction(`(() => {
        const scan = (${SCAN_BOOKSHELF_FN})()
        return scan.refs.length > 0 && scan.refs.map((r) => r.titleId + ':' + r.format).sort().join(',') !== ${JSON.stringify(signature)}
      })()`, undefined, { timeout: 18_000 })
      // The verified page signature is stronger than networkidle: KDP often
      // keeps background requests open indefinitely after rows have loaded.
    } catch (error) {
      if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()
      const observed = await scanPage(page)
      const observedSignature = observed.refs.map(r => r.titleId + ':' + r.format).sort().join(',')
      if (observedSignature !== signature && observed.refs.length > 0) continue
      // One read-only reload can recover a stalled navigation. No create or
      // publish action has started; never accept an incomplete Bookshelf scan.
      if (nextUrl && typeof page.reload === 'function') {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
        if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()
        const reloaded = await scanPage(page)
        const afterReload = reloaded.refs.map(r => r.titleId + ':' + r.format).sort().join(',')
        if (reloaded.refs.length > 0 && afterReload !== signature) continue
      }
      throw new KdpClientError(`KDP Bookshelf pagination stalled after page ${pagesScanned}; a complete signed-in inventory could not be verified. Cause: ${String((error as Error)?.name || 'timeout')}`)
    }
  }
  throw new KdpClientError('KDP Bookshelf scan did not complete.')
}

export function normalizeRefs(raw: Array<{ titleId: string; format: string; asin?: string; asinConflict?: boolean }>): TitleFormatRef[] {
  const map = new Map<string, TitleFormatRef>()
  const conflicts = new Set<string>()
  for (const ref of raw) {
    const format = ref.format as KdpBookFormat
    if (format !== 'kindle' && format !== 'paperback' && format !== 'hardcover') {
      continue
    }
    const key = `${ref.titleId}:${format}`
    const existing = map.get(key)
    if (ref.asinConflict) conflicts.add(key)
    const asin = verifiedRefAsin('', ref.asin)
    if (existing?.asin && asin && existing.asin !== asin) conflicts.add(key)
    map.set(key, { titleId: ref.titleId, format, asin: asin || existing?.asin })
  }
  return [...map.entries()].map(([key, ref]) => conflicts.has(key) ? { ...ref, asin: undefined, asinConflict: true } : ref).sort((a, b) => {
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
  options: { requireFreshPricingAsin?: boolean } = {},
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

  // KDP's price form can select the royalty_rate radio after client-side
  // hydration. Server HTML alone omits it for some existing LIVE books.
  // Read the actual authenticated pricing form rather than assuming 70%.
  if (ref.format === 'kindle' &&
      (!/^(?:35|70)(?:_PERCENT)?$/.test(pricing.royaltyPlan) ||
        (options.requireFreshPricingAsin && !/^B0[A-Z0-9]{8}$/i.test(pricing.asin)))) {
    const response = await kdpGoto(requestPage, setupPageUrl(ref.format, ref.titleId, 'pricing'), {
      waitUntil: 'networkidle', timeout: 120_000,
    }).catch(() => null)
    if (requestPage.url().toLowerCase().includes('signin')) throw new KdpAuthError()
    if (response?.ok()) {
      // The royalty selector may only appear after the signed-in page hydrates.
      // Wait for one *selected* supported plan; never infer it from price,
      // unselected radio options or the catalogue. Keep the wait bounded.
      await requestPage.waitForFunction(`(() => {
        const names = [
          'data[digital][royalty_rate]-radio',
          'data[digital][royalty_plan]',
          'data[digital][royalty_rate]',
        ]
        const value = names.map(name => document.querySelector('input[name="' + name + '"]:checked')?.value?.trim())
          .find(Boolean) ||
          document.querySelector('input[type="hidden"][name="data[digital][royalty_rate]"]')?.value?.trim() ||
          document.querySelector('input[type="hidden"][name="data[digital][royalty_plan]"]')?.value?.trim() || ''
        return /^(?:35|70)(?:_PERCENT)?$/.test(value)
      })()`, undefined, { timeout: 6_000 }).catch(() => null)
      if (requestPage.url().toLowerCase().includes('signin')) throw new KdpAuthError()
      const rendered = await requestPage.evaluate(`(() => {
        const plan = [
          'data[digital][royalty_rate]-radio',
          'data[digital][royalty_plan]',
          'data[digital][royalty_rate]',
        ].map((name) => document.querySelector('input[name="' + name + '"]:checked')?.value?.trim())
          .find(Boolean) ||
          document.querySelector('input[type="hidden"][name="data[digital][royalty_rate]"]')?.value?.trim() ||
          document.querySelector('input[type="hidden"][name="data[digital][royalty_plan]"]')?.value?.trim() || ''
        const bytes = document.querySelector('input[name="data[digital][filesize_bytes]"]')?.value || ''
        const asin = (document.body.innerText.match(/ASIN:\\s*(B0[A-Z0-9]{8})/i) || [])[1] || ''
        return { plan, bytes, asin }
      })()`) as { plan: string; bytes: string; asin: string }
      if (/^(?:35|70)(?:_PERCENT)?$/.test(rendered.plan)) pricing.royaltyPlan = rendered.plan
      if (/^B0[A-Z0-9]{8}$/i.test(rendered.asin)) pricing.asin = rendered.asin.toUpperCase()
      if (/^\d+$/.test(rendered.bytes) && Number.isSafeInteger(Number(rendered.bytes))) {
        pricing.fileSizeKb = String(Math.ceil(Number(rendered.bytes) / 1024))
      }
    }
  }

  // A direct known-title refresh must independently prove the ASIN on this
  // freshly authenticated page. The old cached Bookshelf link is not enough.
  if (options.requireFreshPricingAsin) requireFreshPricingAsin(pricing.asin, ref.asin || '')

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
    asin: ref.asinConflict ? '' : verifiedRefAsin(pricing.asin, ref.asin),
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

/** A partial API/HTML result is not proof that a setup ID is absent. */
export async function requireExactBookshelfRef(
  titleId: string, format: KdpBookFormat, scan: BookshelfScan,
  completeScan: () => Promise<BookshelfScan>,
): Promise<TitleFormatRef> {
  const exact = (refs: TitleFormatRef[]) => refs.find((candidate) => candidate.titleId === titleId && candidate.format === format)
  let ref = exact(scan.refs)
  if (!ref && scan.pagesScanned <= 1) ref = exact((await completeScan()).refs)
  if (!ref) throw new KdpClientError(`KDP Bookshelf has no exact ${format} record for ${titleId}.`)
  return ref
}

/** Refresh metadata for a single title/format and patch the local cache. */
export async function syncBookMetadata(
  titleId: string,
  format: KdpBookFormat,
  expectedAsin?: string,
): Promise<KdpBookMetadata> {
  // A complete signed-in KDP snapshot and D1 already establish the title-ASIN
  // association for royalty-floor remediation. Avoid a second full Bookshelf
  // pagination pass, which timed out on each 19 November production price run.
  // The direct path has a stricter gate: freshly observed pricing-page ASIN.
  const knownTitle = expectedAsin !== undefined
  const knownAsin = String(expectedAsin || '').trim().toUpperCase()
  if (knownTitle && (format !== 'kindle' || !/^[A-Z0-9]{10,20}$/.test(titleId) ||
      !/^B0[A-Z0-9]{8}$/.test(knownAsin))) {
    throw new KdpClientError('Invalid exact-title Kindle ASIN for signed-in KDP refresh.')
  }
  return withKdpPages(async ({ action, parse }) => {
    const ref: TitleFormatRef = knownTitle
      ? { titleId, format, asin: knownAsin }
      : await (async () => {
          const scan = await collectBookshelfRefs(action, parse)
          return requireExactBookshelfRef(titleId, format, scan, () => collectBookshelfRefsViaBrowser(action))
        })()
    const meta = await fetchBookMetadata(action, parse, ref, { requireFreshPricingAsin: knownTitle })
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
