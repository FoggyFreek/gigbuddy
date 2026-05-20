-- Restructure venues contact/address columns to a Mollie-style shape.
-- Splits contact_person into title/given_name/family_name, address into
-- street_and_number/street_additional/postal_code, and renames province → region
-- (widening from CHAR(2) to TEXT so values like "Noord-Holland" fit).
-- Existing contact_person → given_name and address → street_and_number;
-- province text is carried into region as-is.

ALTER TABLE venues
  ADD COLUMN title              TEXT,
  ADD COLUMN given_name         TEXT,
  ADD COLUMN family_name        TEXT,
  ADD COLUMN street_and_number  TEXT,
  ADD COLUMN street_additional  TEXT,
  ADD COLUMN postal_code        TEXT,
  ADD COLUMN region             TEXT;

UPDATE venues
   SET given_name        = NULLIF(trim(contact_person), ''),
       street_and_number = NULLIF(trim(address), ''),
       region            = NULLIF(trim(province), '');

ALTER TABLE venues
  DROP COLUMN contact_person,
  DROP COLUMN address,
  DROP COLUMN province;
