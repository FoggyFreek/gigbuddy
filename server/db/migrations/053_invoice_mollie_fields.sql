ALTER TABLE invoices
  ADD COLUMN mollie_payment_link_id         text,
  ADD COLUMN mollie_payment_link_url        text,
  ADD COLUMN mollie_payment_link_created_at timestamptz,
  ADD COLUMN mollie_payment_link_expires_at timestamptz,
  ADD COLUMN mollie_payment_status          text,
  ADD COLUMN mollie_payment_id              text,
  ADD COLUMN mollie_paid_at                 timestamptz;

CREATE UNIQUE INDEX invoices_mollie_payment_link_id_idx
  ON invoices (mollie_payment_link_id)
  WHERE mollie_payment_link_id IS NOT NULL;
