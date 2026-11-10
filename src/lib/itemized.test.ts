import { getBalances } from './balances'
import { calculateItemizedSplit } from './itemized'
import { expenseFormSchema } from './schemas'
import { getExpenseShares } from './shares'
import { calculateShare } from './totals'

const sharesOf = (split: ReturnType<typeof calculateItemizedSplit>) =>
  Object.fromEntries(
    split.paidFor.map(({ participant, shares }) => [participant, shares]),
  )

describe('calculateItemizedSplit', () => {
  it('bills participants for the items they got', () => {
    const split = calculateItemizedSplit([
      { price: 1500, paidFor: ['alice'] },
      { price: 2200, paidFor: ['bob'] },
      { price: 800, paidFor: ['alice', 'bob'] },
    ])
    expect(split.amount).toBe(4500)
    expect(sharesOf(split)).toEqual({ alice: 1900, bob: 2600 })
  })

  it('gives the remaining cents so that shares sum to the amount', () => {
    const split = calculateItemizedSplit([
      { price: 100, paidFor: ['c', 'b', 'a'] },
    ])
    expect(sharesOf(split)).toEqual({ a: 34, b: 33, c: 33 })
  })

  it('rotates the remaining cent between expenses', () => {
    const favoured = new Set(
      Array.from({ length: 50 }, (_, index) => {
        const { paidFor } = calculateItemizedSplit(
          [{ price: 100, paidFor: ['a', 'b', 'c'] }],
          `expense-${index}`,
        )
        return paidFor.find(({ shares }) => shares === 34)!.participant
      }),
    )
    expect(favoured.size).toBe(3)
  })

  it('does not accumulate rounding errors over items', () => {
    const items = Array.from({ length: 30 }, () => ({
      price: 100,
      paidFor: ['a', 'b', 'c'],
    }))
    expect(sharesOf(calculateItemizedSplit(items))).toEqual({
      a: 1000,
      b: 1000,
      c: 1000,
    })
  })

  it('handles discounts and refunds', () => {
    expect(
      sharesOf(
        calculateItemizedSplit([
          { price: 1000, paidFor: ['a', 'b'] },
          { price: -100, paidFor: ['a'] },
        ]),
      ),
    ).toEqual({ a: 400, b: 500 })
    const refund = calculateItemizedSplit([
      { price: -100, paidFor: ['a', 'b', 'c'] },
    ])
    expect(refund.amount).toBe(-100)
    expect(sharesOf(refund)).toEqual({ a: -33, b: -33, c: -34 })
  })

  it('keeps participants whose share is zero', () => {
    const split = calculateItemizedSplit([
      { price: 500, paidFor: ['a'] },
      { price: 300, paidFor: ['b'] },
      { price: -300, paidFor: ['b'] },
    ])
    expect(sharesOf(split)).toEqual({ a: 500, b: 0 })
  })

  it('does not bill items assigned to nobody', () => {
    const split = calculateItemizedSplit([
      { price: 500, paidFor: ['a'] },
      { price: 300, paidFor: [] },
    ])
    expect(split.amount).toBe(800)
    expect(sharesOf(split)).toEqual({ a: 500 })
  })

  it('always has integer shares summing to the amount, whatever the order', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    let seed = 42
    const random = (max: number) =>
      (seed = (seed * 1103515245 + 12345) % 2 ** 31) % max
    for (let run = 0; run < 500; run++) {
      const items = Array.from({ length: 1 + random(20) }, () => ({
        price: random(10_000) - 1000,
        paidFor: people.slice(0, 1 + random(people.length)),
      }))
      const id = `expense-${run}`
      const split = calculateItemizedSplit(items, id)
      const sum = split.paidFor.reduce((sum, { shares }) => sum + shares, 0)
      expect(sum).toBe(split.amount)
      expect(
        split.paidFor.every(({ shares }) => Number.isInteger(shares)),
      ).toBe(true)

      const reordered = calculateItemizedSplit(
        [...items]
          .reverse()
          .map((item) => ({ ...item, paidFor: [...item.paidFor].reverse() })),
        id,
      )
      expect(sharesOf(reordered)).toEqual(sharesOf(split))
    }
  })
})

describe('balances of an itemized expense', () => {
  const { amount, paidFor } = calculateItemizedSplit([
    { price: 1000, paidFor: ['a', 'b', 'c'] },
    { price: 555, paidFor: ['b'] },
  ])
  const expense = {
    amount,
    splitMode: 'BY_ITEM',
    isReimbursement: false,
    paidBy: { id: 'a', name: 'A' },
    paidFor: paidFor.map(({ participant, shares }) => ({
      participant: { id: participant, name: participant },
      shares,
    })),
  } as Parameters<typeof getBalances>[0][number]

  it('uses the shares as amounts', () => {
    const balances = getBalances([expense])
    expect(balances.a).toEqual({ paid: 1555, paidFor: 334, total: 1221 })
    expect(balances.b.total).toBe(-888)
    expect(balances.c.total).toBe(-333)
    expect(calculateShare('b', expense)).toBe(888)
  })
})

describe('getExpenseShares of an itemized expense', () => {
  it.each([
    [
      'a discount',
      [
        [500, 'a'],
        [300, 'b'],
        [-400, 'b'],
      ],
    ],
    [
      'a share of zero',
      [
        [500, 'a'],
        [300, 'b'],
        [-300, 'b'],
      ],
    ],
    [
      'a refund',
      [
        [-500, 'a'],
        [-333, 'b'],
      ],
    ],
  ] as [string, [number, string][]][])(
    'keeps the exact shares of %s',
    (_, rows) => {
      const split = calculateItemizedSplit(
        rows.map(([price, participant]) => ({ price, paidFor: [participant] })),
        'expense-1',
      )
      const shares = getExpenseShares({
        id: 'expense-1',
        amount: split.amount,
        splitMode: 'BY_ITEM',
        paidFor: split.paidFor.map(({ participant, shares }) => ({
          participantId: participant,
          shares,
        })),
      })
      expect(Object.fromEntries(shares)).toEqual(sharesOf(split))
    },
  )
})

describe('expenseFormSchema', () => {
  const expense = {
    expenseDate: new Date(),
    title: 'Restaurant',
    amount: 10,
    paidBy: 'a',
    paidFor: [{ participant: 'a', shares: '1' }],
    splitMode: 'BY_ITEM',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
  }
  const item = { name: 'Pizza', price: '10.00', paidFor: ['a'] }

  const errorsOf = (values: object) =>
    expenseFormSchema
      .safeParse({ ...expense, ...values })
      .error?.issues.map(({ path, message }) => [path.join('.'), message])

  it('accepts items', () => {
    expect(errorsOf({ items: [item] })).toBeUndefined()
    expect(
      expenseFormSchema.parse({ ...expense, items: [item] }).items[0].price,
    ).toBe(10)
  })

  it('requires items only when splitting by item', () => {
    expect(errorsOf({ items: [] })).toEqual([['items', 'itemsMin1']])
    expect(errorsOf({ splitMode: 'EVENLY' })).toBeUndefined()
  })

  it('requires a name, a price and participants for each item', () => {
    expect(
      errorsOf({ items: [{ name: ' ', price: '', paidFor: [] }] }),
    ).toEqual([
      ['items.0.name', 'min1'],
      ['items.0.price', 'amountNotZero'],
      ['items.0.paidFor', 'itemPaidForMin1'],
    ])
  })
})
