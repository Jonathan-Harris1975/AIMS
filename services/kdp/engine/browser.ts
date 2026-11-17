import fs from 'node:fs'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { sessionFilePath } from './session.ts'
import { ensureKdpLogin } from './login.ts'
import { claimDurableLease, releaseDurableLease } from '../../shared/utils/durableLease.js'

const executablePath = () =>
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || '/usr/bin/chromium'

export async function launchKdpBrowser(headless = true): Promise<Browser> {
  const executable = executablePath()
  if (!fs.existsSync(executable)) {
    throw new Error(`Chromium executable not found at ${executable}.`)
  }
  return chromium.launch({
    headless,
    executablePath: executable,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  })
}

let browserQueue = Promise.resolve()

export async function withKdpBrowserContext<T>(
  fn: (context: BrowserContext) => Promise<T>,
  { autoLogin = true, retryExpired = true, headless = true, viewport = { width: 1920, height: 1080 } } = {},
): Promise<T> {
  const previous = browserQueue
  let release!: () => void
  browserQueue = new Promise<void>((resolve) => { release = resolve })
  await previous

  // All authenticated KDP jobs (print, Kindle prices, metadata, research and
  // manual publishing) share this one account-level R2 lease. Local
  // browserQueue alone cannot protect multiple Koyeb workers or instances.
  let lease: Awaited<ReturnType<typeof claimDurableLease>> | undefined
  try {
    lease = await claimDurableLease({
      namespace: 'kdp-account', key: 'browser-session',
      pendingTtlMs: 110 * 60_000, completedTtlMs: 5_000,
      metadata: { purpose: 'exclusive authenticated KDP browser transaction' },
    })
    if (!lease.claimed || !lease.lease) {
      throw new Error('KDP account session is busy in another production worker; retry after its lease releases.')
    }
    if (process.env.NODE_ENV === 'production' && lease.lease.backend !== 'r2') {
      throw new Error('Live KDP browser operations require the distributed R2 account-session lock.')
    }
    return await withKdpBrowserContextOnce(fn, { autoLogin, retryExpired, headless, viewport })
  } finally {
    if (lease?.claimed && lease.lease) {
      await releaseDurableLease(lease.lease).catch(() => {})
    }
    release()
  }
}

async function withKdpBrowserContextOnce<T>(fn, options): Promise<T> {
  const { autoLogin, retryExpired, headless, viewport } = options
  if (autoLogin) await ensureKdpLogin()
  else if (!fs.existsSync(sessionFilePath())) {
    const error = new Error('Amazon KDP session is not connected.')
    error.name = 'KdpAuthError'
    throw error
  }

  const browser = await launchKdpBrowser(headless)
  try {
    const context = await browser.newContext({ storageState: sessionFilePath(), viewport })
    try {
      return await fn(context)
    } catch (error) {
      if (!retryExpired || error?.name !== 'KdpAuthError') throw error
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
      const { removeSession } = await import('./session.ts')
      await removeSession()
      await ensureKdpLogin()
      return withKdpBrowserContextOnce(fn, { ...options, autoLogin: false, retryExpired: false })
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
