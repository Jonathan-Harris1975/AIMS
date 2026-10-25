import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const KDP_REQUEST_DELAY_MS = Math.max(
  1000,
  Number(process.env.KDP_REQUEST_DELAY_MS || process.env.KDP_UPDATE_DELAY_MS || 4000),
)

// KDP session cookies are private browser credentials. Keep them on the
// container's private temporary filesystem and re-authenticate after restarts.
export const SESSION_DIR = process.env.KDP_SESSION_DIR || path.join(os.tmpdir(), 'aims-kdp-session')
export const SESSION_FILE = path.join(SESSION_DIR, 'amazon-kdp.json')

export const KDP_REPORTS_ORIGIN = 'https://kdpreports.amazon.com'
export const KDP_ROYALTIES_PAGE = `${KDP_REPORTS_ORIGIN}/reports/royalties`
export const KDP_PMR_PAGE = `${KDP_REPORTS_ORIGIN}/reports/pmr`

export const KDP_API = {
  accountInfo: `${KDP_REPORTS_ORIGIN}/metadata/customer/accountInfo`,
  reportsMetadata: `${KDP_REPORTS_ORIGIN}/metadata/reports/reportsMetadata`,
  customerMetadata: `${KDP_REPORTS_ORIGIN}/api/v2/reports/customerMetadata`,
  booksMetadata: `${KDP_REPORTS_ORIGIN}/api/v2/reports/booksMetadata`,
  pagesReadByAsin: `${KDP_REPORTS_ORIGIN}/api/v2/reports/pagesReadByAsin`,
  generateReport: `${KDP_REPORTS_ORIGIN}/download/report/royaltiesestimator/en_US/royaltiesEstimatorReport.xslx`,
  pmrReport: `${KDP_REPORTS_ORIGIN}/download/report/pmr/en_US/pmrReport.xslx`,
} as const

export const KDP_ENGINE_DIR = path.resolve(__dirname)
