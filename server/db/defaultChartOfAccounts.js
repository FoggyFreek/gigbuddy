// Default chart of accounts for every new tenant.
// ORDER IS SIGNIFICANT: parents must appear before their children (self-referential FK is IMMEDIATE).
// The migration backfill SQL (064_chart_of_accounts.sql) duplicates this list — keep in sync.

export const DEFAULT_ACCOUNTS = [
  // ---- level 0: top-level (no parent) ----
  { code: '10000', name: 'Assets',            type: 'asset',              parent_code: null },
  { code: '20000', name: 'Liabilities',       type: 'liability',          parent_code: null },
  { code: '30000', name: 'Equity',            type: 'equity',             parent_code: null },
  { code: '40000', name: 'Revenue',           type: 'revenue',            parent_code: null },
  { code: '50000', name: 'Cost of Goods Sold',type: 'cost_of_goods_sold', parent_code: null },                                                                                                                                               
  { code: '60000', name: 'Operating Expenses',type: 'expense',            parent_code: null },  
  // ---- level 1 ----
  { code: '11000', name: 'Primary Bank Account',                          type: 'asset',              parent_code: '10000' },
  { code: '12000', name: 'Inventory',                                     type: 'asset',              parent_code: '10000' },
  { code: '13000', name: 'Owned Gear',                                    type: 'asset',              parent_code: '10000' },
  { code: '14000', name: 'Band Van or Vehicle',                           type: 'asset',              parent_code: '10000' },
  { code: '15000', name: 'Value Added Tax / VAT Receivable',              type: 'asset',              parent_code: '10000' },
  { code: '15010', name: 'VAT Receivable from Tax Authority',             type: 'asset',              parent_code: '10000' },
  { code: '21000', name: 'Short-term Payables',                           type: 'liability',          parent_code: '20000' },
  { code: '22000', name: 'Due to Band Members',                           type: 'liability',          parent_code: '20000' },
  { code: '24000', name: 'Sales Tax / VAT Payable',                       type: 'liability',          parent_code: '20000' },
  { code: '24010', name: 'VAT Payable to Tax Authority',                  type: 'liability',          parent_code: '20000' },
  { code: '31000', name: 'Band Member Capital Contributions',             type: 'equity',             parent_code: '30000' },
  { code: '32000', name: 'Band Member Draws (Payouts)',                   type: 'equity',             parent_code: '30000' },
  { code: '33000', name: 'Retained Earnings',                             type: 'equity',             parent_code: '30000' },
  { code: '39000', name: 'Opening Balance Equity',                        type: 'equity',             parent_code: '30000' },
  { code: '41000', name: 'Gig fees',                                      type: 'revenue',            parent_code: '40000' },
  { code: '42000', name: 'Merchandise Sales',                             type: 'revenue',            parent_code: '40000' },
  { code: '43000', name: 'Digital Streaming & Download Royalties',        type: 'revenue',            parent_code: '40000' },
  { code: '44000', name: 'Publishing & Sync Licensing',                   type: 'revenue',            parent_code: '40000' },
  { code: '51000', name: 'Merchandise',                                   type: 'cost_of_goods_sold', parent_code: '50000' },
  { code: '61000', name: 'Touring',                                       type: 'expense',            parent_code: '60000' },
  { code: '62000', name: 'Gear & Production',                             type: 'expense',            parent_code: '60000' },
  { code: '63000', name: 'Marketing & Promo',                             type: 'expense',            parent_code: '60000' },
  { code: '64000', name: 'Business & Admin',                              type: 'expense',            parent_code: '60000' },

  // ---- level 2 ----
  { code: '11200', name: 'Accounts Receivable',                           type: 'asset',              parent_code: '11000' },
  { code: '12100', name: 'Inventory - Vinyl and CDs',                     type: 'asset',              parent_code: '12000' },
  { code: '12200', name: 'Inventory - Merchandise',                       type: 'asset',              parent_code: '12000' },
  { code: '21100', name: 'Accounts Payable',                              type: 'liability',          parent_code: '21000' },                                                                                                                                                    
  { code: '21200', name: 'Accrued Expenses',                              type: 'liability',          parent_code: '21000' },
  { code: '42100', name: 'Merchandise Sales - Vinyl and CDs',             type: 'revenue',            parent_code: '42000' },
  { code: '51100', name: 'Merch Manufacturing',                           type: 'cost_of_goods_sold', parent_code: '51000' },
  { code: '51200', name: 'Shipping & Packaging',                          type: 'cost_of_goods_sold', parent_code: '51000' },
  { code: '51300', name: 'Venue Merch Cuts',                              type: 'cost_of_goods_sold', parent_code: '51000' },
  { code: '61100', name: 'Travel & Lodging',                              type: 'expense',            parent_code: '61000' },
  { code: '61200', name: 'Vehicle Gas & Tolls',                           type: 'expense',            parent_code: '61000' },
  { code: '62100', name: 'Instruments & Equipment',                       type: 'expense',            parent_code: '62000' },
  { code: '62200', name: 'Gear Maintenance & Repairs',                    type: 'expense',            parent_code: '62000' },
  { code: '62300', name: 'Studio Rental & Engineering',                   type: 'expense',            parent_code: '62000' },
  { code: '62400', name: 'Rehearsal Space Rent',                          type: 'expense',            parent_code: '62000' },
  { code: '63100', name: 'Advertising & PR',                              type: 'expense',            parent_code: '63000' },
  { code: '63200', name: 'Artwork, Photo & Video',                        type: 'expense',            parent_code: '63000' },
  { code: '63300', name: 'Digital Distribution & Software Subscriptions', type: 'expense',            parent_code: '63000' },
  { code: '64200', name: 'Hired Musicians & Contractors',                 type: 'expense',            parent_code: '64000' },
]

const DEFAULT_SETTINGS = {
  currency: 'EUR',
  receivable_account_code: '11200',
  default_revenue_account_code: '41000',
  payable_account_code: '21100',
  default_reimbursement_account_code: '22000',
  default_expense_account_code: '62100',
  primary_checking_account_code: '11000',
  output_vat_account_code: '24000',
  input_vat_account_code: '15000',
  vat_receivable_settlement_account_code: '15010',
  vat_payable_settlement_account_code: '24010',
}

// Seeds the chart of accounts + settings row for a single tenant.
// client can be a pool or a transaction client (both expose .query).
// Safe to call multiple times: uses ON CONFLICT DO NOTHING.
export async function seedTenantAccounting(client, tenantId) {
  for (const acc of DEFAULT_ACCOUNTS) {
    await client.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, acc.code, acc.name, acc.type, acc.parent_code ?? null],
    )
  }
  await client.query(
    `INSERT INTO tenant_accounting_settings (
       tenant_id, currency,
       receivable_account_code, default_revenue_account_code,
       payable_account_code, default_reimbursement_account_code, default_expense_account_code,
       primary_checking_account_code,
       output_vat_account_code, input_vat_account_code,
       vat_receivable_settlement_account_code, vat_payable_settlement_account_code
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [
      tenantId,
      DEFAULT_SETTINGS.currency,
      DEFAULT_SETTINGS.receivable_account_code,
      DEFAULT_SETTINGS.default_revenue_account_code,
      DEFAULT_SETTINGS.payable_account_code,
      DEFAULT_SETTINGS.default_reimbursement_account_code,
      DEFAULT_SETTINGS.default_expense_account_code,
      DEFAULT_SETTINGS.primary_checking_account_code,
      DEFAULT_SETTINGS.output_vat_account_code,
      DEFAULT_SETTINGS.input_vat_account_code,
      DEFAULT_SETTINGS.vat_receivable_settlement_account_code,
      DEFAULT_SETTINGS.vat_payable_settlement_account_code,
    ],
  )
}
