-- Chart of Accounts + Accounting Settings for the ledger feature (feature-ledger).
-- See plan: C:\Users\joris\.claude\plans\fetch-github-issue-63-deep-token.md

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code ~ '^[0-9]{4,6}$'),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','cost_of_goods_sold','expense')),
  parent_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, parent_code) REFERENCES chart_of_accounts(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS tenant_accounting_settings (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  receivable_account_code TEXT,
  default_revenue_account_code TEXT,
  payable_account_code TEXT,
  default_expense_account_code TEXT,
  primary_checking_account_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, receivable_account_code)        REFERENCES chart_of_accounts(tenant_id, code),
  FOREIGN KEY (tenant_id, default_revenue_account_code)   REFERENCES chart_of_accounts(tenant_id, code),
  FOREIGN KEY (tenant_id, payable_account_code)           REFERENCES chart_of_accounts(tenant_id, code),
  FOREIGN KEY (tenant_id, default_expense_account_code)   REFERENCES chart_of_accounts(tenant_id, code),
  FOREIGN KEY (tenant_id, primary_checking_account_code)  REFERENCES chart_of_accounts(tenant_id, code)
);

-- Backfill existing tenants: level 0 (top-level, no parent)
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, v.code, v.name, v.type::text, NULL, true
FROM tenants t
CROSS JOIN (VALUES
  ('10000', 'Assets',            'asset'),
  ('20000', 'Liabilities',       'liability'),
  ('30000', 'Equity',            'equity'),
  ('40000', 'Revenue',           'revenue'),
  ('50000', 'Cost of Goods Sold','cost_of_goods_sold'),
  ('60000', 'Operating Expenses','expense')
) AS v(code, name, type)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Backfill level 1 (children of top-level)
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, v.code, v.name, v.type::text, v.parent_code, true
FROM tenants t
CROSS JOIN (VALUES
  ('11000', 'Primary Bank Account',                 'asset',              '10000'),
  ('12000', 'Inventory',                            'asset',              '10000'),
  ('13000', 'Owned Gear',                           'asset',              '10000'),
  ('14000', 'Band Van or Vehicle',                  'asset',              '10000'),
  ('21000', 'Short-term Payables',                  'liability',          '20000'),
  ('24000', 'Sales Tax / VAT Payable',              'liability',          '20000'),
  ('31000', 'Band Member Capital Contributions',    'equity',             '30000'),
  ('32000', 'Band Member Draws (Payouts)',           'equity',             '30000'),
  ('33000', 'Retained Earnings',                    'equity',             '30000'),
  ('39000', 'Opening Balance Equity',               'equity',             '30000'),
  ('41000', 'Gig fees',                             'revenue',            '40000'),
  ('42000', 'Merchandise Sales',                    'revenue',            '40000'),
  ('43000', 'Digital Streaming & Download Royalties','revenue',            '40000'),
  ('44000', 'Publishing & Sync Licensing',          'revenue',            '40000'),
  ('51000', 'Merchandise',                          'cost_of_goods_sold', '50000'),
  ('61000', 'Touring',                              'expense',            '60000'),
  ('62000', 'Gear & Production',                    'expense',            '60000'),
  ('63000', 'Marketing & Promo',                    'expense',            '60000'),
  ('64000', 'Business & Admin',                     'expense',            '60000')
) AS v(code, name, type, parent_code)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Backfill level 2 (grandchildren — must follow level 1 due to self-referential FK)
INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
SELECT t.id, v.code, v.name, v.type::text, v.parent_code, true
FROM tenants t
CROSS JOIN (VALUES
  ('11200', 'Accounts Receivable',                           'asset',              '11000'),
  ('12100', 'Inventory - Vinyl and CDs',                     'asset',              '12000'),
  ('12200', 'Inventory - Merchandise',                       'asset',              '12000'),
  ('21100', 'Accounts Payable',                              'liability',          '21000'),
  ('21200', 'Accrued Expenses',                              'liability',          '21000'),
  ('42100', 'Merchandise Sales - Vinyl and CDs',             'revenue',            '42000'),
  ('51100', 'Merch Manufacturing',                           'cost_of_goods_sold', '51000'),
  ('51200', 'Shipping & Packaging',                          'cost_of_goods_sold', '51000'),
  ('51300', 'Venue Merch Cuts',                              'cost_of_goods_sold', '51000'),
  ('61100', 'Travel & Lodging',                              'expense',            '61000'),
  ('61200', 'Vehicle Gas & Tolls',                           'expense',            '61000'),
  ('62100', 'Instruments & Equipment',                       'expense',            '62000'),
  ('62200', 'Gear Maintenance & Repairs',                    'expense',            '62000'),
  ('62300', 'Studio Rental & Engineering',                   'expense',            '62000'),
  ('62400', 'Rehearsal Space Rent',                          'expense',            '62000'),
  ('63100', 'Advertising & PR',                              'expense',            '63000'),
  ('63200', 'Artwork, Photo & Video',                        'expense',            '63000'),
  ('63300', 'Digital Distribution & Software Subscriptions', 'expense',            '63000'),
  ('64200', 'Hired Musicians & Contractors',                 'expense',            '64000')
) AS v(code, name, type, parent_code)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Backfill settings for existing tenants
INSERT INTO tenant_accounting_settings (
  tenant_id, currency,
  receivable_account_code, default_revenue_account_code,
  payable_account_code, default_expense_account_code,
  primary_checking_account_code
)
SELECT id, 'EUR', '11200', '41000', '21100', '62100', '11000'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;
