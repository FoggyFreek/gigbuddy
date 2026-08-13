-- Country-default labels for the chart of accounts.
--
-- `default_name` is the label the account was seeded with for the tenant's
-- accounting country; `name` is what the tenant sees. `name_is_customized`
-- records whether the tenant deliberately renamed it, so a later country change
-- can re-label the untouched accounts without clobbering custom wording. It is
-- a stored fact rather than a `name <> default_name` comparison, because a
-- country change rewrites default_name and would break that comparison.
--
-- Reset-to-default eligibility is decided by `is_system`, never by these columns.
--
-- This file is deliberately re-runnable so the migration test can reconstruct
-- legacy rows and replay it.

ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS default_name TEXT;
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS name_is_customized BOOLEAN NOT NULL DEFAULT FALSE;

-- The seeded chart, duplicated from server/db/defaultChartOfAccounts.js and
-- server/domain/accountNamePacks.js — keep the three in sync.
WITH pack(code, base_name, nl_name) AS (
  VALUES
    ('10000', 'Assets',                                        'Activa'),
    ('20000', 'Liabilities',                                   'Vreemd vermogen'),
    ('30000', 'Equity',                                        'Eigen vermogen'),
    ('40000', 'Revenue',                                       'Omzet'),
    ('50000', 'Cost of Goods Sold',                            'Kostprijs van de omzet'),
    ('60000', 'Operating Expenses',                            'Bedrijfskosten'),
    ('70000', 'Other Operating Income',                        'Overige bedrijfsopbrengsten'),
    ('11000', 'Primary Bank Account',                          'Bankrekening'),
    ('11100', 'Cash on hand',                                  'Kas'),
    ('12000', 'Inventory',                                     'Voorraad'),
    ('13000', 'Owned Gear',                                    'Apparatuur en instrumenten'),
    ('14000', 'Band Van or Vehicle',                           'Bedrijfsauto of tourbus'),
    ('15000', 'Value Added Tax / VAT Receivable',              'Te vorderen btw (voorbelasting)'),
    ('15010', 'VAT Receivable from Tax Authority',             'Te vorderen btw van de Belastingdienst'),
    ('21000', 'Short-term Payables',                           'Kortlopende schulden'),
    ('22000', 'Due to Band Members',                           'Rekening-courant bandleden'),
    ('24000', 'Sales Tax / VAT Payable',                       'Te betalen btw'),
    ('24010', 'VAT Payable to Tax Authority',                  'Te betalen btw aan de Belastingdienst'),
    ('31000', 'Band Member Capital Contributions',             'Kapitaalstortingen bandleden'),
    ('32000', 'Band Member Draws (Payouts)',                   'Privé-opnamen bandleden'),
    ('33000', 'Retained Earnings',                             'Ingehouden winst'),
    ('39000', 'Opening Balance Equity',                        'Openingsbalans eigen vermogen'),
    ('41000', 'Gig fees',                                      'Gages optredens'),
    ('42000', 'Merchandise Sales',                             'Merchandiseomzet'),
    ('43000', 'Digital Streaming & Download Royalties',        'Streaming- en downloadroyalty''s'),
    ('44000', 'Publishing & Sync Licensing',                   'Uitgave- en synclicenties'),
    ('51000', 'Merchandise',                                   'Inkoopwaarde merchandise'),
    ('61000', 'Touring',                                       'Touring'),
    ('62000', 'Gear & Production',                             'Apparatuur en productie'),
    ('63000', 'Marketing & Promo',                             'Marketing en promotie'),
    ('64000', 'Business & Admin',                              'Algemene en administratieve kosten'),
    ('71000', 'Grants & Subsidies',                            'Subsidies en fondsen'),
    ('11200', 'Accounts Receivable',                           'Debiteuren'),
    ('11300', 'Shopify Payments Clearing',                     'Shopify Payments tussenrekening'),
    ('11400', 'PayPal Clearing',                               'PayPal tussenrekening'),
    ('12100', 'Inventory - Vinyl and CDs',                     'Voorraad vinyl en cd''s'),
    ('12200', 'Inventory - Merchandise',                       'Voorraad merchandise'),
    ('13100', 'Accumulated Depreciation - Gear',               'Cumulatieve afschrijving apparatuur'),
    ('21100', 'Accounts Payable',                              'Crediteuren'),
    ('21200', 'Accrued Expenses',                              'Nog te betalen kosten'),
    ('42100', 'Merchandise Sales - Vinyl and CDs',             'Merchandiseomzet vinyl en cd''s'),
    ('51100', 'Merch Manufacturing',                           'Productiekosten merchandise'),
    ('51200', 'Shipping & Packaging',                          'Verzend- en verpakkingskosten'),
    ('51300', 'Venue Merch Cuts',                              'Merchandiseafdracht aan zalen'),
    ('61100', 'Travel & Lodging',                              'Reis- en verblijfkosten'),
    ('61200', 'Vehicle Gas & Tolls',                           'Brandstof en tolkosten'),
    ('62100', 'Instruments & Equipment',                       'Instrumenten en apparatuur'),
    ('62200', 'Gear Maintenance & Repairs',                    'Onderhoud en reparatie apparatuur'),
    ('62300', 'Studio Rental & Engineering',                   'Studiohuur en opnametechniek'),
    ('62400', 'Rehearsal Space Rent',                          'Huur repetitieruimte'),
    ('62900', 'Depreciation Expense',                          'Afschrijvingskosten'),
    ('63100', 'Advertising & PR',                              'Reclame en PR'),
    ('63200', 'Artwork, Photo & Video',                        'Artwork, foto en video'),
    ('63300', 'Digital Distribution & Software Subscriptions', 'Digitale distributie en softwareabonnementen'),
    ('64100', 'Payment Processing Fees',                       'Betalingsverwerkingskosten'),
    ('64200', 'Hired Musicians & Contractors',                 'Ingehuurde musici en freelancers'),
    ('64900', 'VAT rounding differences',                      'Afrondingsverschillen btw')
)
UPDATE chart_of_accounts coa
   SET default_name = CASE
         WHEN (
           SELECT prof.country_code
             FROM tenant_accounting_profiles prof
            WHERE prof.tenant_id = coa.tenant_id
         ) = 'nl' THEN pack.nl_name
         ELSE pack.base_name
       END
  FROM pack
 WHERE coa.default_name IS NULL
   AND coa.is_system = TRUE
   AND coa.code = pack.code;

-- Everything else — tenant-created accounts, and any system code added outside
-- the seeded chart — defaults to its own current name. Those rows are still
-- gated on is_system, so this only guarantees the NOT NULL below.
UPDATE chart_of_accounts
   SET default_name = name
 WHERE default_name IS NULL;

-- Existing names are never rewritten, so a Dutch tenant seeded before this
-- migration keeps its English labels and simply shows a reset affordance.
UPDATE chart_of_accounts
   SET name_is_customized = TRUE
 WHERE name IS DISTINCT FROM default_name
   AND name_is_customized = FALSE;

ALTER TABLE chart_of_accounts ALTER COLUMN default_name SET NOT NULL;

-- Deploys migrate while the previous app container still serves, and its INSERT
-- omits default_name. A BEFORE INSERT trigger runs ahead of the NOT NULL check,
-- so those writes still succeed — and `default_name = name` is exactly the right
-- rule for a tenant-created account, making this a permanent invariant rather
-- than a deploy-window crutch.
CREATE OR REPLACE FUNCTION coa_default_name_fallback()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.default_name IS NULL THEN
    NEW.default_name := NEW.name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coa_default_name_fallback_trg ON chart_of_accounts;
CREATE TRIGGER coa_default_name_fallback_trg
  BEFORE INSERT ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION coa_default_name_fallback();
