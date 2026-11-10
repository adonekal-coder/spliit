import { createExpense, getGroupExpenses, updateExpense } from './api'
import { prisma } from './prisma'
import { ExpenseFormValues } from './schemas'

jest.mock('./prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    activity: { create: jest.fn() },
    expense: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    group: { findUnique: jest.fn() },
    recurringExpenseLink: { findMany: jest.fn() },
  },
}))

let mockIdCount = 0
jest.mock('./random', () => ({
  randomId: () => `random-id-${++mockIdCount}`,
}))

describe('getGroupExpenses', () => {
  it('copies the documents of a recurring expense to the next occurrence instead of moving them', async () => {
    const document = {
      id: 'document-1',
      url: 'https://example.com/receipt.jpg',
      width: 800,
      height: 600,
      expenseId: 'expense-1',
    }
    const currentFrameExpense = {
      id: 'expense-1',
      groupId: 'group-1',
      title: 'Rent',
      amount: 1000,
      categoryId: 0,
      paidById: 'participant-1',
      recurrenceRule: 'DAILY',
      createdAt: new Date(),
      category: null,
      paidBy: { id: 'participant-1' },
      paidFor: [
        { expenseId: 'expense-1', participantId: 'participant-1', shares: 1 },
      ],
      items: [
        {
          id: 'item-1',
          expenseId: 'expense-1',
          name: 'Room',
          price: 1000,
          position: 0,
          paidFor: [{ itemId: 'item-1', participantId: 'participant-1' }],
        },
      ],
      documents: [document],
    }

    const createExpense = jest.fn(async ({ data }) => ({
      ...currentFrameExpense,
      id: data.id,
      createdAt: new Date(),
    }))
    const transaction = {
      expense: { create: createExpense },
      recurringExpenseLink: { update: jest.fn() },
    }

    jest.mocked(prisma.recurringExpenseLink.findMany).mockResolvedValue([
      {
        id: 'link-1',
        groupId: 'group-1',
        currentFrameExpenseId: 'expense-1',
        // An hour ago, so exactly one daily occurrence is due.
        nextExpenseDate: new Date(Date.now() - 60 * 60 * 1000),
        nextExpenseCreatedAt: null,
        currentFrameExpense,
      },
    ] as never)
    jest
      .mocked(prisma.$transaction)
      .mockImplementation((async (callback: (tx: unknown) => unknown) =>
        callback(transaction)) as never)
    jest.mocked(prisma.expense.findMany).mockResolvedValue([])

    await getGroupExpenses('group-1')

    expect(createExpense).toHaveBeenCalledTimes(1)
    const { documents } = createExpense.mock.calls[0][0].data
    expect(documents).toEqual({
      createMany: {
        data: [
          {
            id: expect.any(String),
            url: document.url,
            width: document.width,
            height: document.height,
          },
        ],
      },
    })
    // Reusing the id would point the existing document at the new expense
    // and take it away from the expense it was uploaded for.
    expect(documents.createMany.data[0].id).not.toBe(document.id)

    const { items } = createExpense.mock.calls[0][0].data
    expect(items.create).toEqual([
      {
        id: expect.stringMatching(/^random-id-/),
        name: 'Room',
        price: 1000,
        position: 0,
        paidFor: { create: [{ participantId: 'participant-1' }] },
      },
    ])
  })
})

describe('createRecurringExpenses', () => {
  const day = (date: Date) => date.toISOString().slice(0, 10)

  function setUp({
    recurrenceRule,
    expenseDate,
    nextExpenseDate,
    anchorDay,
  }: {
    recurrenceRule: string | null
    expenseDate: Date
    nextExpenseDate: Date
    anchorDay: number | null
  }) {
    const currentFrameExpense = {
      id: 'expense-1',
      groupId: 'group-1',
      title: 'Rent',
      amount: 1000,
      categoryId: 0,
      paidById: 'participant-1',
      recurrenceRule,
      expenseDate,
      createdAt: new Date(),
      category: null,
      paidBy: { id: 'participant-1' },
      paidFor: [],
      items: [],
      documents: [],
    }
    const createExpense = jest.fn(async ({ data }) => ({
      ...currentFrameExpense,
      id: data.id,
      expenseDate: data.expenseDate,
      createdAt: new Date(),
    }))
    const updateLink = jest.fn()
    const transaction = {
      expense: { create: createExpense },
      recurringExpenseLink: { update: updateLink },
    }
    jest.mocked(prisma.recurringExpenseLink.findMany).mockResolvedValue([
      {
        id: 'link-1',
        groupId: 'group-1',
        currentFrameExpenseId: 'expense-1',
        nextExpenseDate,
        nextExpenseCreatedAt: null,
        anchorDay,
        currentFrameExpense,
      },
    ] as never)
    jest
      .mocked(prisma.$transaction)
      .mockImplementation((async (callback: (tx: unknown) => unknown) =>
        callback(transaction)) as never)
    jest.mocked(prisma.expense.findMany).mockResolvedValue([])
    return { createExpense, updateLink }
  }

  beforeEach(() => jest.clearAllMocks())

  it.each([null, 'NONE'])(
    'creates nothing and returns when the rule is %p',
    async (recurrenceRule) => {
      const { createExpense } = setUp({
        recurrenceRule,
        expenseDate: new Date(Date.UTC(2025, 0, 31)),
        nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
        anchorDay: null,
      })

      await getGroupExpenses('group-1')

      expect(createExpense).not.toHaveBeenCalled()
    },
  )

  it('keeps the stored anchor day across a short month', async () => {
    const { createExpense } = setUp({
      recurrenceRule: 'MONTHLY',
      expenseDate: new Date(Date.UTC(2025, 0, 31)),
      nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
      anchorDay: 31,
    })

    await getGroupExpenses('group-1')

    const created = createExpense.mock.calls.map(([{ data }]) => data)
    expect(day(created[0].expenseDate)).toBe('2025-02-28')
    expect(day(created[1].expenseDate)).toBe('2025-03-31')
    expect(created[0].recurringExpenseLink.create.anchorDay).toBe(31)
  })

  it('derives the anchor day of a link created before the column existed', async () => {
    const { createExpense, updateLink } = setUp({
      recurrenceRule: 'MONTHLY',
      expenseDate: new Date(Date.UTC(2025, 0, 31)),
      nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
      anchorDay: null,
    })

    await getGroupExpenses('group-1')

    const created = createExpense.mock.calls.map(([{ data }]) => data)
    expect(day(created[1].expenseDate)).toBe('2025-03-31')
    expect(created[0].recurringExpenseLink.create.anchorDay).toBe(31)
    expect(updateLink.mock.calls[0][0].data.anchorDay).toBe(31)
  })
})

describe('updateExpense', () => {
  const existingExpense = {
    id: 'expense-1',
    groupId: 'group-1',
    title: 'Rent',
    expenseDate: new Date(Date.UTC(2025, 0, 15)),
    recurrenceRule: 'MONTHLY',
    paidFor: [{ expenseId: 'expense-1', participantId: 'participant-1' }],
    items: [],
    documents: [],
    recurringExpenseLink: {
      id: 'link-1',
      nextExpenseCreatedAt: null,
      nextExpenseDate: new Date(Date.UTC(2025, 1, 15)),
      anchorDay: 15,
    },
  }

  const formValues = (
    overrides: Partial<ExpenseFormValues>,
  ): ExpenseFormValues =>
    ({
      expenseDate: existingExpense.expenseDate,
      title: 'Rent',
      category: 0,
      amount: 1000,
      paidBy: 'participant-1',
      paidFor: [{ participant: 'participant-1', shares: 1 }],
      splitMode: 'EVENLY',
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'MONTHLY',
      ...overrides,
    }) as ExpenseFormValues

  async function linkUpdate(values: ExpenseFormValues) {
    jest.mocked(prisma.group.findUnique).mockResolvedValue({
      id: 'group-1',
      participants: [{ id: 'participant-1' }],
    } as never)
    jest
      .mocked(prisma.expense.findUnique)
      .mockResolvedValue(existingExpense as never)
    await updateExpense('group-1', 'expense-1', values)
    return jest.mocked(prisma.expense.update).mock.calls[0][0].data
      .recurringExpenseLink
  }

  beforeEach(() => jest.clearAllMocks())

  it('reschedules the next occurrence from the new expense date', async () => {
    const link = await linkUpdate(
      formValues({ expenseDate: new Date(Date.UTC(2025, 0, 31)) }),
    )

    expect(link).toEqual({
      update: {
        nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
        anchorDay: 31,
      },
      delete: false,
    })
  })

  it('leaves the link alone when neither the date nor the rule changes', async () => {
    const link = await linkUpdate(formValues({ title: 'New rent' }))

    expect(link).toEqual({ delete: false })
  })

  it('only deletes the link when the rule is switched to NONE', async () => {
    const link = await linkUpdate(
      formValues({
        recurrenceRule: 'NONE',
        expenseDate: new Date(Date.UTC(2025, 0, 31)),
      }),
    )

    expect(link).toEqual({ delete: true })
  })

  it('clears the anchor day when switching to weekly', async () => {
    const link = await linkUpdate(formValues({ recurrenceRule: 'WEEKLY' }))

    expect(link?.update).toEqual({
      nextExpenseDate: new Date(Date.UTC(2025, 0, 22)),
      anchorDay: null,
    })
  })
})

describe('itemized expenses', () => {
  const item = { name: 'Pizza', price: 1000, paidFor: ['alice', 'bob'] }
  const formValues = (
    overrides: Partial<ExpenseFormValues> = {},
  ): ExpenseFormValues =>
    ({
      expenseDate: new Date(Date.UTC(2025, 0, 15)),
      title: 'Restaurant',
      category: 0,
      amount: 1500,
      paidBy: 'alice',
      paidFor: [{ participant: 'bob', shares: 1 }], // must be ignored
      items: [item, { name: 'Wine', price: 500, paidFor: ['alice'] }],
      splitMode: 'BY_ITEM',
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
      ...overrides,
    }) as ExpenseFormValues

  const sorted = (rows: unknown) =>
    (rows as { participantId: string; shares: number }[]).toSorted((a, b) =>
      a.participantId.localeCompare(b.participantId),
    )

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(prisma.group.findUnique).mockResolvedValue({
      id: 'group-1',
      participants: [{ id: 'alice' }, { id: 'bob' }],
    } as never)
  })

  it('derives the shares from the items', async () => {
    await createExpense(formValues(), 'group-1')

    const { data } = jest.mocked(prisma.expense.create).mock.calls[0][0] as any
    expect(sorted(data.paidFor.createMany.data)).toEqual([
      { participantId: 'alice', shares: 1000 },
      { participantId: 'bob', shares: 500 },
    ])
    expect(data.items.create.map((item: any) => item.position)).toEqual([0, 1])
  })

  it('rejects an amount that does not match the items', async () => {
    await expect(
      createExpense(formValues({ amount: 999 }), 'group-1'),
    ).rejects.toThrow('sum of item prices')
    expect(prisma.expense.create).not.toHaveBeenCalled()
  })

  it('rejects items assigned to someone outside of the group', async () => {
    await expect(
      createExpense(
        formValues({
          amount: 1000,
          items: [{ ...item, paidFor: ['stranger'] }],
        }),
        'group-1',
      ),
    ).rejects.toThrow('Invalid participant ID: stranger')
    expect(prisma.expense.create).not.toHaveBeenCalled()
  })

  it('drops the items when switching to another split mode', async () => {
    jest.mocked(prisma.expense.findUnique).mockResolvedValue({
      id: 'expense-1',
      expenseDate: new Date(Date.UTC(2025, 0, 15)),
      recurrenceRule: 'NONE',
      paidFor: [{ participantId: 'bob' }],
      items: [{ id: 'item-1' }],
      documents: [],
      recurringExpenseLink: null,
    } as never)

    await updateExpense(
      'group-1',
      'expense-1',
      formValues({ splitMode: 'EVENLY' }),
    )

    const { data } = jest.mocked(prisma.expense.update).mock.calls[0][0]
    expect(data.items).toEqual({
      create: [],
      deleteMany: { id: { in: ['item-1'] } },
    })
  })
})
