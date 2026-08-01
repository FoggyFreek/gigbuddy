ALTER TABLE tenant_accounting_settings
  ADD CONSTRAINT tenant_accounting_settings_input_vat_distinct
  CHECK (
    input_vat_account_code IS NULL OR (
      input_vat_account_code IS DISTINCT FROM receivable_account_code AND
      input_vat_account_code IS DISTINCT FROM primary_checking_account_code AND
      input_vat_account_code IS DISTINCT FROM cash_account_code AND
      input_vat_account_code IS DISTINCT FROM default_revenue_account_code AND
      input_vat_account_code IS DISTINCT FROM payable_account_code AND
      input_vat_account_code IS DISTINCT FROM default_reimbursement_account_code AND
      input_vat_account_code IS DISTINCT FROM default_expense_account_code AND
      input_vat_account_code IS DISTINCT FROM output_vat_account_code AND
      input_vat_account_code IS DISTINCT FROM vat_receivable_settlement_account_code AND
      input_vat_account_code IS DISTINCT FROM vat_payable_settlement_account_code AND
      input_vat_account_code IS DISTINCT FROM merch_inventory_account_code AND
      input_vat_account_code IS DISTINCT FROM merch_revenue_account_code AND
      input_vat_account_code IS DISTINCT FROM merch_cogs_account_code AND
      input_vat_account_code IS DISTINCT FROM vat_rounding_account_code
    )
  );

ALTER TABLE tenant_accounting_settings
  ADD CONSTRAINT tenant_accounting_settings_output_vat_distinct
  CHECK (
    output_vat_account_code IS NULL OR (
      output_vat_account_code IS DISTINCT FROM receivable_account_code AND
      output_vat_account_code IS DISTINCT FROM primary_checking_account_code AND
      output_vat_account_code IS DISTINCT FROM cash_account_code AND
      output_vat_account_code IS DISTINCT FROM default_revenue_account_code AND
      output_vat_account_code IS DISTINCT FROM payable_account_code AND
      output_vat_account_code IS DISTINCT FROM default_reimbursement_account_code AND
      output_vat_account_code IS DISTINCT FROM default_expense_account_code AND
      output_vat_account_code IS DISTINCT FROM input_vat_account_code AND
      output_vat_account_code IS DISTINCT FROM vat_receivable_settlement_account_code AND
      output_vat_account_code IS DISTINCT FROM vat_payable_settlement_account_code AND
      output_vat_account_code IS DISTINCT FROM merch_inventory_account_code AND
      output_vat_account_code IS DISTINCT FROM merch_revenue_account_code AND
      output_vat_account_code IS DISTINCT FROM merch_cogs_account_code AND
      output_vat_account_code IS DISTINCT FROM vat_rounding_account_code
    )
  );
