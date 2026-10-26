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

async function safePageDiagnostics(page): Promise<string> {
  const [title, visibleInputs, visibleActionCount, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('input').evaluateAll((elements) => elements
      .filter((element) => {
        const style = window.getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
      })
      .slice(0, 12)
      .map((element) => ({
        id: (element.id || '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 80) || null,
        name: (element.getAttribute('name') || '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 80) || null,
        type: (element.getAttribute('type') || 'text').toLowerCase().slice(0, 24),
        autocomplete: (element.getAttribute('autocomplete') || '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 40) || null,
      }))
    )
    .catch(() => []),
    page.locator('button, input[type="submit"]').evaluateAll((elements) => elements
      .filter((element) => {
        const style = window.getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0
      }).length)
      .catch(() => 0),
    page.locator('body').innerText().catch(() => ''),
  ])
  const normalizedBody = bodyText.toLowerCase()
  const safeTitle = title
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b\d{6}\b/g, '[code]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
    .replace(/\s+/g, ' ')
    .slice(0, 100)

  return JSON.stringify({
    location: safePageLocation(page),
    title: safeTitle,
    visibleInputs,
    visibleActionCount,
    indicators: {
      captchaOrRobotCheck: /captcha|robot check|automated access|unusual traffic|verify.{0,20}human|sorry, we just need to make sure/.test(normalizedBody),
      identityOrSecurityCheck: /verify.{0,20}identity|confirm.{0,20}account|suspicious activity|security check/.test(normalizedBody),
      passwordPrompt: /password/.test(normalizedBody),
      verificationPrompt: /verification code|one[- ]time|security code|\botp\b/.test(normalizedBody),
      emailOrPhonePrompt: /email|phone number/.test(normalizedBody),
    },
  })
}

async function signInFailure(page, stage: 'email' | 'password' | 'otp'): Promise<Error> {
  const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
  const location = safePageLocation(page)
  let diagnostics = ''
  try {
    diagnostics = await safePageDiagnostics(page)
  } catch {
    diagnostics = ''
  }
  const fail = (message: string) => new Error(message + ' Page diagnostics: ' + diagnostics)

  if (/captcha|robot check|sorry, we just need to make sure/.test(bodyText)) {
    return fail('Amazon presented a robot check that cannot be completed by the automated sign-in flow (' + location + ').')
  }
  if (/verify.{0,20}identity|confirm.{0,20}account|suspicious activity|security check/.test(bodyText)) {
    return fail('Amazon presented an identity or security check that the automated sign-in flow cannot complete (' + location + ').')
  }
  if (/incorrect.*password|wrong.*password|password.*incorrect|email.*not found|account.*does not exist/.test(bodyText)) {
    return fail('Amazon rejected the sign-in details at the ' + stage + ' step (' + location + '). Check the KDP_USERNAME and KDP_PASSWORD secrets.')
  }
  if (stage === 'email') {
    return fail('Amazon did not show a password or verification field after the email step. Sign-in stopped before password submission (' + location + ').')
  }
  if (stage === 'password') {
    return fail('Amazon did not show an OTP field or the KDP reports page after password submission (' + location + ').')
  }
  return fail('Amazon accepted the OTP step but did not reach the KDP reports page (' + location + ').')
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
  const startOtpChallenge = () => {
    if (otpChallenge) return
    // Start listening before either credential submission so an immediate
    // TextBee delivery cannot be discarded while the next form loads.
    otpChallenge = beginKdpOtpChallenge()
    void otpChallenge.promise.catch(() => {})
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    await page.goto(KDP_ROYALTIES_PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    if (!(await isAuthenticated(page))) {
      const emailInput = await firstVisible(page, EMAIL_SELECTORS)
      if (emailInput) {
        await emailInput.fill(username)
        startOtpChallenge()
        if (!(await clickFirst(page, ['#continue', 'input#continue', 'button[type="submit"]']))) {
          await emailInput.press('Enter')
        }
      }

      let passwordInput = null
      let otpInput = null
      const stepDeadline = Date.now() + 30_000
      while (Date.now() < stepDeadline) {
        passwordInput = await firstVisible(page, PASSWORD_SELECTORS)
        if (passwordInput) break
        otpInput = await visibleOtpInput(page)
        if (otpInput || await isAuthenticated(page)) break
        await page.waitForTimeout(250)
      }

      if (passwordInput) {
        await passwordInput.fill(password)
        startOtpChallenge()
        if (!(await clickFirst(page, ['#signInSubmit', 'input#signInSubmit', 'button[type="submit"]']))) {
          await passwordInput.press('Enter')
        }
        await passwordInput.fill('').catch(() => {})
        otpInput = await waitForOtpInput(page)
      } else if (!otpInput && !(await isAuthenticated(page))) {
        throw await signInFailure(page, 'email')
      }

      if (otpInput) {
        startOtpChallenge()
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
