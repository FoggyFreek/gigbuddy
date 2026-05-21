ALTER TABLE invoices
  ADD COLUMN customer_contact_title      TEXT,
  ADD COLUMN customer_contact_given_name TEXT,
  ADD COLUMN customer_contact_family_name TEXT;
