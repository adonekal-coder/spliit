/**
 * Calculates how much each participant owes based on the items they got.
 * The price of an item is split evenly among the participants who got it.
 *
 * Shares are rounded so that they are all integers whose sum is exactly the total amount: rounding is done once
 * on the total of each participant (not for each item), then the remaining minor units are given to the participants
 * with the largest remainders. The result does not depend on the order of the items or participants.
 *
 * @param items The items, with prices in minor units of currency (integers)
 */
export function calculateItemizedSplit(
  items: { price: number; paidFor: string[] }[],
): {
  amount: number
  paidFor: { participant: string; shares: number }[]
} {
  const exactShares = new Map<string, number>()
  for (const { price, paidFor } of items) {
    for (const participant of paidFor) {
      exactShares.set(
        participant,
        (exactShares.get(participant) ?? 0) + price / paidFor.length,
      )
    }
  }

  const paidFor = Array.from(exactShares, ([participant, exactShare]) => {
    const shares = Math.floor(exactShare)
    return {
      participant,
      shares,
      // Ignore floating point noise when comparing remainders
      remainder: Number((exactShare - shares).toFixed(6)),
    }
  }).sort(
    (a, b) =>
      b.remainder - a.remainder || (a.participant < b.participant ? -1 : 1),
  )

  const amount = items.reduce((sum, { price }) => sum + price, 0)
  // Items assigned to nobody cannot be billed yet
  const billedAmount = items.reduce(
    (sum, { price, paidFor }) => (paidFor.length > 0 ? sum + price : sum),
    0,
  )
  const missing =
    billedAmount - paidFor.reduce((sum, { shares }) => sum + shares, 0)

  return {
    amount,
    paidFor: paidFor.map(({ participant, shares }, index) => ({
      participant,
      shares: index < missing ? shares + 1 : shares,
    })),
  }
}
