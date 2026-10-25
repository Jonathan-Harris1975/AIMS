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

async function visibleOtpInput(page) {
  return firstVisible(page, [
    '#auth-mfa-otpcode',
    'input[name="otpCode"]',
    'input[autocomplete="one-time-code"]',
    'input[name="code"]',
    'input[id*="otp"]',
  ])
}

async function waitForOtpInput(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const input = await visibleOtpInput(page)
    if (input) return input
    const url = page.url().toLowerCase()
    if (url.includes('kdpreports.amazon.com') && url.includes('/reports/') && !url.includes('signin')) return null
    await page.waitForTimeout(500)
  }
  return null
}

async function isAuthenticated(page): Promise<boolean> {
  const url = page.url().toLowerCase()
  if (!url.includes('kdpreports.amazon.com') || !url.includes('/reports/') || url.includes('signin')) return false
  const html = await page.content().catch(() => '')
  return html.includes('csrftoken') || html.includes('customerAccountInfoModel')
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
      let emailInput = await firstVisible(page, ['#ap_email', 'input[name="email"]', 'input[type="email"]'])
      if (emailInput) {
        await emailInput.fill(username)
        if (!(await clickFirst(page, ['#continue', 'input#continue', 'button[type="submit"]']))) {
          await emailInput.press('Enter')
        }
      }

      const passwordInput = await page.locator('#ap_password, input[name="password"], input[type="password"]').first()
      await passwordInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
      if (await passwordInput.isVisible().catch(() => false)) {
        await passwordInput.fill(password)
        // Register before submitting credentials so a fast TextBee delivery
        // cannot arrive before the OTP broker is listening.
        otpChallenge = beginKdpOtpChallenge()
        void otpChallenge.promise.catch(() => {})
        if (!(await clickFirst(page, ['#signInSubmit', 'input#signInSubmit', 'button[type="submit"]']))) {
          await passwordInput.press('Enter')
        }
        await passwordInput.fill('').catch(() => {})
      }

      let otpInput = await waitForOtpInput(page)
      if (otpInput) {
        if (!otpChallenge) throw new Error('Amazon requested an SMS verification code before the KDP password step completed.')
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
        const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
        const reason = /captcha|robot check|sorry, we just need to make sure/.test(bodyText)
          ? 'Amazon presented a robot check that cannot be completed by the automated sign-in flow.'
          : 'Amazon sign-in did not reach the KDP reports page. Check the KDP credentials and sign-in requirements.'
        throw new Error(reason)
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
