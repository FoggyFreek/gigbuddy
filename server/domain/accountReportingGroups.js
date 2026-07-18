// Profit-and-loss presentation is a separate concern from an account's
// accounting type. The type owns debit/credit behavior; the reporting group
// decides where result-account activity appears in financial reports.
export const ACCOUNT_REPORTING_GROUPS = Object.freeze({
  OPERATING_REVENUE: 'operating_revenue',
  OTHER_OPERATING_INCOME: 'other_operating_income',
  COST_OF_GOODS_SOLD: 'cost_of_goods_sold',
  OPERATING_EXPENSE: 'operating_expense',
})

const DEFAULT_BY_ACCOUNT_TYPE = Object.freeze({
  revenue: ACCOUNT_REPORTING_GROUPS.OPERATING_REVENUE,
  cost_of_goods_sold: ACCOUNT_REPORTING_GROUPS.COST_OF_GOODS_SOLD,
  expense: ACCOUNT_REPORTING_GROUPS.OPERATING_EXPENSE,
})

export function defaultReportingGroupForType(type) {
  return DEFAULT_BY_ACCOUNT_TYPE[type] ?? null
}
