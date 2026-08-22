ALTER TABLE contacts ADD COLUMN first_name TEXT CHECK (length(first_name) <= 100);
