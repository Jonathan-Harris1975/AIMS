import type { Page } from 'playwright-core'
import { KdpAuthError, KdpClientError } from './kdpClient.ts'
import { kdpGoto } from './kdpHttp.ts'
import { withKdpPage } from './kdpMetadata.ts'
import type { KdpBookFormat } from './metadataStore.ts'

const BOOKSHELF_URL = 'https://kdp.amazon.com/en_US/bookshelf'

export type KdpTitleActionResult = {
  titleId: string
  format: KdpBookFormat
  action: 'unpublish' | 'delete' | 'archive'
  success: boolean
  errors: string[]
}

async function findTitleRow(page: Page, titleId: string) {
  return page.locator(`tr[id="${titleId}"], tr:has(a[href*="${titleId}"])`).first()
}

export async function unpublishTitleOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()

  const label =
    format === 'kindle'
      ? 'Unpublish eBook'
      : format === 'hardcover'
        ? 'Unpublish hardcover'
        : 'Unpublish paperback'

  const row = await findTitleRow(page, titleId)
  const link = row.getByText(label, { exact: true })
  const clicked = await link.click({ timeout: 10_000, force: true }).then(() => true).catch(() => false)

  if (!clicked) {
    return {
      titleId,
      format,
      action: 'unpublish',
      success: false,
      errors: [`Could not find "${label}" on Bookshelf.`],
    }
  }

  await page.waitForTimeout(2000)
  const confirm = page.getByRole('button', { name: /confirm|unpublish|yes/i }).first()
  if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirm.click({ timeout: 10_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  }

  return { titleId, format, action: 'unpublish', success: true, errors: [] }
}

async function expandTitleRow(page: Page, titleId: string): Promise<void> {
  const manage = page.locator(
    `#zme-indie-bookshelf-dual-itemset-itemset-actions-column-itemset-actions-${titleId}`,
  )
  if (await manage.isVisible({ timeout: 3000 }).catch(() => false)) {
    await manage.click({ timeout: 10_000 })
    await page.waitForTimeout(1500)
  }
}

/**
 * Format-level actions (Delete Paperback, Download manuscript, …) live in an
 * ellipsis "other actions" popover inside the row's actions cell — not in the
 * "Manage title" itemset menu. Open it so the action links become visible.
 */
async function openFormatActionsPopover(page: Page, titleId: string): Promise<boolean> {
  const trigger = page
    .locator(`span[id$="${titleId}-other-actions"] a.a-popover-trigger, span[id$="${titleId}-other-actions"]`)
    .first()
  if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await trigger.click({ timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    return true
  }
  // Fallback: any visible popover trigger inside the row's actions cell.
  const cellTriggers = page.locator(
    `td#${titleId}-actions span.a-declarative[data-action="a-popover"] a.a-popover-trigger`,
  )
  const count = await cellTriggers.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const t = cellTriggers.nth(i)
    if (await t.isVisible().catch(() => false)) {
      await t.click({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      return true
    }
  }
  return false
}

function formatDeletePrefix(format: KdpBookFormat): string {
  return format === 'kindle' ? 'kindle_delete' : format === 'hardcover' ? 'hardcover_delete' : 'print_delete'
}

export async function deleteTitleOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  if (page.url().toLowerCase().includes('signin')) throw new KdpAuthError()

  const row = await findTitleRow(page, titleId)
  if ((await row.count()) === 0) {
    return {
      titleId,
      format,
      action: 'delete',
      success: false,
      errors: [`Title ${titleId} not found on Bookshelf.`],
    }
  }

  const prefix = formatDeletePrefix(format)

  // Delete links are hidden inside the row's "other actions" ellipsis popover.
  await openFormatActionsPopover(page, titleId)

  let deleteLink = row.locator(`a[id^="${prefix}-"]:visible`).first()
  if ((await deleteLink.count()) === 0) {
    // Popover content may be teleported outside the row element.
    deleteLink = page.locator(`a[id^="${prefix}-"]:visible`).first()
  }

  let clicked = false
  if ((await deleteLink.count()) > 0) {
    clicked = await deleteLink
      .click({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  }

  if (!clicked) {
    // Last resort: JS-click the link inside the row (may be a no-op if KDP
    // requires the popover flow — verification below catches that).
    clicked = await page
      .evaluate(
        ({ id, pfx }) => {
          const rows = document.querySelectorAll(`tr#${id}`)
          for (const rowEl of rows) {
            const link = rowEl.querySelector(`a[id^="${pfx}-"]`) as HTMLElement | null
            if (link) {
              link.click()
              return true
            }
          }
          return false
        },
        { id: titleId, pfx: prefix },
      )
      .catch(() => false)
  }

  if (!clicked) {
    return {
      titleId,
      format,
      action: 'delete',
      success: false,
      errors: ['Could not find delete action on Bookshelf.'],
    }
  }

  await page.waitForTimeout(2000)
  // KDP shows an "Are you sure?" modal whose confirm button is "#delete-title-ok-announce" (label "OK").
  const confirm = page
    .locator('#delete-title-ok-announce:visible')
    .or(page.locator('[role=dialog]:visible, .a-popover:visible').getByRole('button', { name: /^(OK|Delete|Confirm|Yes)$/i }))
    .first()
  if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirm.click({ timeout: 10_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  }

  // Verify the format row is actually gone instead of blindly reporting success.
  await page.waitForTimeout(3000)
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  const stillThere = await page
    .locator(`tr[id="${titleId}"] a[id^="${prefix}-"]`)
    .count()
    .then((c) => c > 0)
    .catch(() => false)
  if (stillThere) {
    return {
      titleId,
      format,
      action: 'delete',
      success: false,
      errors: ['Delete was clicked but the title is still on the Bookshelf. It may require manual deletion.'],
    }
  }

  return { titleId, format, action: 'delete', success: true, errors: [] }
}

export async function archiveTitleOnPage(
  page: Page,
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  await kdpGoto(page, BOOKSHELF_URL, { waitUntil: 'networkidle', timeout: 120_000 })
  const row = await findTitleRow(page, titleId)
  const clicked = await row
    .getByText('Archive title', { exact: true })
    .click({ timeout: 10_000, force: true })
    .then(() => true)
    .catch(() => false)

  if (!clicked) {
    return {
      titleId,
      format,
      action: 'archive',
      success: false,
      errors: ['Could not find Archive title on Bookshelf.'],
    }
  }

  await page.waitForTimeout(2000)
  const confirm = page.getByRole('button', { name: /archive|confirm|yes/i }).first()
  if (await confirm.isVisible({ timeout: 5000 }).catch(() => false)) {
    await confirm.click({ timeout: 10_000 })
  }

  return { titleId, format, action: 'archive', success: true, errors: [] }
}

export async function unpublishTitle(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  return withKdpPage((page) => unpublishTitleOnPage(page, titleId, format))
}

export async function deleteTitle(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  return withKdpPage((page) => deleteTitleOnPage(page, titleId, format))
}

export async function archiveTitle(
  titleId: string,
  format: KdpBookFormat,
): Promise<KdpTitleActionResult> {
  return withKdpPage((page) => archiveTitleOnPage(page, titleId, format))
}
