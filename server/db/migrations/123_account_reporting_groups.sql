-- Separate accounting behavior (`type`) from profit-and-loss presentation.
-- This keeps Other Operating Income credit-nature revenue while excluding it
-- from the operating-revenue subtotal used to calculate gross profit.
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS reporting_group TEXT;

UPDATE chart_of_accounts
   SET reporting_group = CASE type
     WHEN 'revenue' THEN 'operating_revenue'
     WHEN 'cost_of_goods_sold' THEN 'cost_of_goods_sold'
     WHEN 'expense' THEN 'operating_expense'
     ELSE NULL
   END;

-- Classify the system-owned 70000 tree independently of account-code prefixes,
-- so custom descendants inherit the correct report placement too.
WITH RECURSIVE other_operating_income_accounts AS (
  SELECT tenant_id, code
    FROM chart_of_accounts
   WHERE code = '70000'
     AND type = 'revenue'
     AND is_system = true
  UNION ALL
  SELECT child.tenant_id, child.code
    FROM chart_of_accounts child
    JOIN other_operating_income_accounts parent
      ON parent.tenant_id = child.tenant_id
     AND parent.code = child.parent_code
   WHERE child.type = 'revenue'
)
UPDATE chart_of_accounts account
   SET reporting_group = 'other_operating_income'
  FROM other_operating_income_accounts other_income
 WHERE account.tenant_id = other_income.tenant_id
   AND account.code = other_income.code;

ALTER TABLE chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_reporting_group_check CHECK (
    (type IN ('asset', 'liability', 'equity') AND reporting_group IS NULL)
    OR (type = 'revenue' AND reporting_group IS NOT NULL
        AND reporting_group IN ('operating_revenue', 'other_operating_income'))
    OR (type = 'cost_of_goods_sold' AND reporting_group IS NOT NULL
        AND reporting_group = 'cost_of_goods_sold')
    OR (type = 'expense' AND reporting_group IS NOT NULL
        AND reporting_group = 'operating_expense')
  );
