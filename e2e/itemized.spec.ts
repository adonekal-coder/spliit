import { Locator, Page } from '@playwright/test'
import {
  createGroup,
  expectBalance,
  EXPENSES_URL,
  openExpense,
  openTab,
  uniqueSuffix,
} from './app'
import { expect, test } from './fixtures'
import { fieldByLabel, fillStable, money, selectRadixOption } from './ui'

const PARTICIPANTS = ['Alice', 'Bob', 'Carol']

function itemRow(page: Page, index: number): Locator {
  return page.getByTestId('expense-item').nth(index)
}

async function fillItem(
  page: Page,
  index: number,
  item: { name: string; price: string; gotBy: string[] },
): Promise<void> {
  if (index > 0) {
    await page.getByRole('button', { name: 'Add item' }).click()
  }
  const row = itemRow(page, index)
  await fillStable(row.getByPlaceholder('Item name'), item.name)
  await fillStable(row.getByLabel('Price', { exact: true }), item.price)
  for (const name of item.gotBy) {
    await row.getByRole('button', { name, exact: true }).click()
  }
}

async function startExpense(page: Page, groupId: string, title: string) {
  await page.goto(`/groups/${groupId}/expenses/create`)
  await expect(
    page.getByRole('button', { name: 'Create', exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await fillStable(page.locator('input[name="title"]'), title)
  await selectRadixOption(page, page.getByTestId('paid-by'), 'Alice')
}

async function submit(page: Page, name: 'Create' | 'Save') {
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForURL(EXPENSES_URL, { timeout: 30_000 })
}

test('bills participants for the items they got', async ({ page }) => {
  const groupId = await createGroup(page, {
    name: `E2E Items ${uniqueSuffix()}`,
    participants: PARTICIPANTS,
  })

  await startExpense(page, groupId, 'Dinner')
  await page
    .getByRole('button', { name: 'Enter items and prices instead' })
    .click()
  await fillItem(page, 0, { name: 'Pizza', price: '15', gotBy: ['Alice'] })
  await fillItem(page, 1, { name: 'Pasta', price: '12.50', gotBy: ['Bob'] })
  await fillItem(page, 2, { name: 'Wine', price: '21', gotBy: ['Everyone'] })
  await fillItem(page, 3, { name: 'Coupon', price: '-3', gotBy: ['Carol'] })

  const amount = page.locator('input[name="amount"]')
  await expect(amount).toHaveValue('45.50')
  await expect(amount).not.toBeEditable()
  const summary = page.getByTestId('items-summary')
  await expect(summary).toContainText(money(22))
  await expect(summary).toContainText(money(19.5))
  await expect(summary).toContainText(money(4))
  await submit(page, 'Create')

  await openTab(page, 'Balances')
  await expectBalance(page, 'Alice', 23.5)
  await expectBalance(page, 'Bob', -19.5)
  await expectBalance(page, 'Carol', -4)

  // The items can be changed afterwards.
  await openTab(page, 'Expenses')
  await openExpense(page, 'Dinner')
  await expect(page.getByTestId('expense-item')).toHaveCount(4)
  await itemRow(page, 3).getByLabel('Remove item').click()
  await itemRow(page, 2)
    .getByRole('button', { name: 'Bob', exact: true })
    .click()
  await expect(amount).toHaveValue('48.50')
  await submit(page, 'Save')

  await openTab(page, 'Balances')
  await expectBalance(page, 'Alice', 23)
  await expectBalance(page, 'Bob', -12.5)
  await expectBalance(page, 'Carol', -10.5)
})

test('can go back to a total amount, even with an unfinished item', async ({
  page,
}) => {
  const groupId = await createGroup(page, {
    name: `E2E ItemsOff ${uniqueSuffix()}`,
    participants: PARTICIPANTS,
  })

  await startExpense(page, groupId, 'Taxi')
  await fillStable(page.locator('input[name="amount"]'), '30')
  await page
    .getByRole('button', { name: 'Enter items and prices instead' })
    .click()
  await itemRow(page, 0).getByRole('button', { name: 'Bob' }).click()
  await page
    .getByRole('button', { name: 'Enter a total amount instead' })
    .click()

  await expect(page.locator('input[name="amount"]')).toHaveValue('30')
  await submit(page, 'Create')

  await openTab(page, 'Balances')
  await expectBalance(page, 'Alice', 20)
  await expectBalance(page, 'Bob', -10)
  await expectBalance(page, 'Carol', -10)
})

test('requires each item to be complete', async ({ page }) => {
  const groupId = await createGroup(page, {
    name: `E2E ItemsInvalid ${uniqueSuffix()}`,
    participants: PARTICIPANTS,
  })

  await startExpense(page, groupId, 'Incomplete')
  await page
    .getByRole('button', { name: 'Enter items and prices instead' })
    .click()
  const create = page.getByRole('button', { name: 'Create', exact: true })
  await create.click()
  await expect(page.getByText('Select who got this item.')).toBeVisible()

  await itemRow(page, 0).getByLabel('Remove item').click()
  await create.click()
  await expect(page.getByText('Enter at least one item.')).toBeVisible()
  await expect(page).toHaveURL(/\/expenses\/create/)
})

test('saves the leftover cent where it was previewed', async ({ page }) => {
  const groupId = await createGroup(page, {
    name: `E2E ItemsCent ${uniqueSuffix()}`,
    participants: PARTICIPANTS,
  })

  for (const title of ['Coffee', 'Tea', 'Cake']) {
    await startExpense(page, groupId, title)
    await page
      .getByRole('button', { name: 'Enter items and prices instead' })
      .click()
    await fillItem(page, 0, { name: title, price: '10', gotBy: ['Everyone'] })
    const summary = page.getByTestId('items-summary')
    await expect(summary).toContainText(money(3.34))
    const previewed = await summary.innerText()
    await submit(page, 'Create')

    await openExpense(page, title)
    await expect(summary).toHaveText(previewed, { useInnerText: true })
  }
})

test.describe('in another currency', () => {
  test.use({ exchangeRate: 0.5 })

  test('converts the price of each item', async ({ page }) => {
    const groupId = await createGroup(page, {
      name: `E2E ItemsCurrency ${uniqueSuffix()}`,
      participants: PARTICIPANTS,
    })
    await startExpense(page, groupId, 'Abroad')
    await page
      .getByRole('button', { name: 'Enter items and prices instead' })
      .click()
    await selectRadixOption(
      page,
      fieldByLabel(page, 'Currency of expense').getByRole('combobox'),
      /Euro \(EUR\)/,
    )
    await fillStable(itemRow(page, 0).getByPlaceholder('Item name'), 'Tapas')
    await fillStable(itemRow(page, 0).getByLabel('Price to convert'), '19')
    await itemRow(page, 0).getByRole('button', { name: 'Bob' }).click()
    await expect(page.locator('input[name="amount"]')).toHaveValue('9.50')
    await submit(page, 'Create')

    await openTab(page, 'Balances')
    await expectBalance(page, 'Bob', -9.5)
  })
})
