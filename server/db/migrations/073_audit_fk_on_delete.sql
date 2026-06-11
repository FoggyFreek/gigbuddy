-- Audit FKs from 072 must not block the physical user delete path
-- (server/routes/adminUsers.js). The columns are nullable historical
-- references, so a deleted user simply leaves NULL behind.

ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS ledger_transactions_created_by_user_id_fkey,
  ADD CONSTRAINT ledger_transactions_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE journals
  DROP CONSTRAINT IF EXISTS journals_created_by_user_id_fkey,
  ADD CONSTRAINT journals_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS journals_approved_by_user_id_fkey,
  ADD CONSTRAINT journals_approved_by_user_id_fkey
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_created_by_user_id_fkey,
  ADD CONSTRAINT purchases_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS purchases_approved_by_user_id_fkey,
  ADD CONSTRAINT purchases_approved_by_user_id_fkey
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS purchases_payment_registered_by_user_id_fkey,
  ADD CONSTRAINT purchases_payment_registered_by_user_id_fkey
    FOREIGN KEY (payment_registered_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_created_by_user_id_fkey,
  ADD CONSTRAINT invoices_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reimbursements
  DROP CONSTRAINT IF EXISTS reimbursements_created_by_user_id_fkey,
  ADD CONSTRAINT reimbursements_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
