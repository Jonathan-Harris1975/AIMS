import fs from 'node:fs'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { sessionFilePath } from './session.ts'
import { ensureKdpLogin } from './login.ts'

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

  try {
    return await withKdpBrowserContextOnce(fn, { autoLogin, retryExpired, headless, viewport })
  } finally {
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
