import fs from 'node:fs/promises'
import { KDP_ROYALTIES_PAGE } from './config.ts'
import { ensureSessionDir, sessionFilePath, sessionExists } from './session.ts'
import { launchKdpBrowser } from './browser.ts'
import { beginKdpOtpChallenge } from '../otpBroker.js'

let loginInProgress = false
let loginError: string | null = null
let loginPromise: Promise<void> | null = null

export function getLoginState(): { loginInProgress: boolean; loginError: string | null } {
  return { loginInProgress, loginError }
}

function firstVisible(page, selectors: string[]) {
  return (async () => {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      try {
        if (await locator.isVisible()) return locator
      } catch { /* A selector may not exist in the current Amazon sign-in step. */ }
    }
    return null
  })()
}

async function clickFirst(page, selectors: string[]): Promise<boolean> {
  const button = await firstVisible(page, selectors)
  if (!button) return false
  await button.click()
  return true
}

const EMAIL_SELECTORS = ['#ap_email', 'input[name="email"]', 'input[type="email"]']
const PASSWORD_SELECTORS = ['#ap_password', 'input[name="password"]', 'input[type="password"]']
const OTP_SELECTORS = [
  '#auth-mfa-otpcode',
  'input[name="otpCode"]',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input[id*="otp"]',
]

async function visibleOtpInput(page) {
  return firstVisible(page, OTP_SELECTORS)
}

function isKdpReportsDashboardUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const pathSegments = url.pathname.toLowerCase().split('/').filter(Boolean)
    return url.protocol === 'https:'
      && url.hostname === 'kdpreports.amazon.com'
      && pathSegments[0] === 'reports'
      && !pathSegments.includes('signin')
  } catch {
    return false
  }
}

async function waitForOtpInput(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const input = await visibleOtpInput(page)
    if (input) return input
    if (isKdpReportsDashboardUrl(page.url())) return null
    await page.waitForTimeout(500)
  }
  return null
}

async function waitForVisible(page, selectors: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const input = await firstVisible(page, selectors)
    if (input) return input
    await page.waitForTimeout(250)
  }
  return null
}

async function isAuthenticated(page): Promise<boolean> {
  if (!isKdpReportsDashboardUrl(page.url())) return false
  const html = await page.content().catch(() => '')
  return html.includes('csrftoken') || html.includes('customerAccountInfoModel')
}

function safePageLocation(page): string {
  try {
    const url = new URL(page.url())
    return url.hostname + url.pathname
  } catch {
    return 'unknown Amazon sign-in page'
  }
}

async function signInFailure(page, stage: 'email' | 'password' | 'otp'): Promise<Error> {
  const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
  const location = safePageLocation(page)
  if (/captcha|robot check|sorry, we just need to make sure/.test(bodyText)) {
    return new Error('Amazon presented a robot check that cannot be completed by the automated sign-in flow (' + location + ').')
  }
  if (/incorrect.*password|wrong.*password|password.*incorrect|email.*not found|account.*does not exist/.test(bodyText)) {
    return new Error('Amazon rejected the sign-in details at the ' + stage + ' step (' + location + '). Check the KDP_USERNAME and KDP_PASSWORD secrets.')
  }
  if (stage === 'email') {
    return new Error('Amazon did not show a password or verification field after the email step. Sign-in stopped before password submission (' + location + ').')
  }
  if (stage === 'password') {
    return new Error('Amazon did not show an OTP field or the KDP reports page after password submission (' + location + ').')
  }
  return new Error('Amazon accepted the OTP step but did not reach the KDP reports page (' + location + ').')
}

async function saveSession(context): Promise<void> {
  await ensureSessionDir()
  const file = sessionFilePath()
  await context.storageState({ path: file })
  await fs.chmod(file, 0o600)
}

async function runAutomatedLogin(): Promise<void> {
  const username = String(process.env.KDP_USERNAME || '').trim()
  const password = String(process.env.KDP_PASSWORD || '')
  if (!username || !password) throw new Error('KDP_USERNAME and KDP_PASSWORD must be configured in Koyeb secrets.')

  await ensureSessionDir()
  const browser = await launchKdpBrowser(true)
  let otpChallenge = null
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    await page.goto(KDP_ROYALTIES_PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    if (!(await isAuthenticated(page))) {
      const emailInput = await firstVisible(page, EMAIL_SELECTORS)
      if (emailInput) {
        await emailInput.fill(username)
        if (!(await clickFirst(page, ['#continue', 'input#continue', 'button[type="submit"]']))) {
          await emailInput.press('Enter')
        }
      }

      let passwordInput = await waitForVisible(page, PASSWORD_SELECTORS, 30_000)
      let otpInput = null

      if (passwordInput) {
        await passwordInput.fill(password)
        // Register before submitting credentials so a fast TextBee delivery
        // cannot arrive before the OTP broker is listening.
        otpChallenge = beginKdpOtpChallenge()
        void otpChallenge.promise.catch(() => {})
        if (!(await clickFirst(page, ['#signInSubmit', 'input#signInSubmit', 'button[type="submit"]']))) {
          await passwordInput.press('Enter')
        }
        await passwordInput.fill('').catch(() => {})
        otpInput = await waitForOtpInput(page)
      } else {
        // Amazon can occasionally request verification directly after the
        // account identifier step. Start the broker only when that screen is
        // actually present, and fail clearly if the password step never came.
        otpInput = await waitForVisible(page, OTP_SELECTORS, 2_000)
        if (otpInput) {
          otpChallenge = beginKdpOtpChallenge()
          void otpChallenge.promise.catch(() => {})
        } else if (!(await isAuthenticated(page))) {
          throw await signInFailure(page, 'email')
        }
      }

      if (otpInput) {
        if (!otpChallenge) throw new Error('Amazon requested an SMS verification code, but no OTP challenge could be started.')
        let code = ''
        try {
          code = await otpChallenge.promise
          await otpInput.fill(code)
          code = ''
          if (!(await clickFirst(page, ['#auth-signin-button', 'input#auth-signin-button', 'button[type="submit"]']))) {
            await otpInput.press('Enter')
          }
        } finally {
          code = ''
          otpChallenge.cancel('Amazon sign-in finished before the OTP was consumed.')
        }
      }

      const deadline = Date.now() + 60_000
      while (Date.now() < deadline && !(await isAuthenticated(page))) {
        await page.waitForTimeout(750)
        if (await visibleOtpInput(page)) {
          throw new Error('Amazon requested another verification step; this login flow supports one SMS OTP challenge per sign-in.')
        }
      }
      if (!(await isAuthenticated(page))) {
        throw await signInFailure(page, otpInput ? 'otp' : 'password')
      }
      otpChallenge?.cancel('Amazon sign-in completed without consuming an OTP.')
    }

    await saveSession(context)
    await context.close()
  } finally {
    otpChallenge?.cancel('Amazon sign-in ended before the OTP was consumed.')
    await browser.close()
  }
}

export async function ensureKdpLogin(): Promise<void> {
  if (await sessionExists()) return
  if (loginPromise) return loginPromise

  loginInProgress = true
  loginError = null
  loginPromise = runAutomatedLogin()
    .catch((error) => {
      loginError = error instanceof Error ? error.message : 'Unexpected error during Amazon sign-in.'
      throw error
    })
    .finally(() => {
      loginInProgress = false
      loginPromise = null
    })
  return loginPromise
}

export async function startInteractiveLogin(): Promise<void> {
  return ensureKdpLogin()
}
