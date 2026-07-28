-- Public business contact details for the band, shown on issued documents.
--
-- These are the SELLER CONTACT fields of EN 16931 (BT-41 name, BT-42 telephone,
-- BT-43 email). They are optional in the core standard but mandatory for a
-- domestic German e-invoice (Peppol DE-R-002/005/006/007), which is why a DE->DE
-- invoice cannot currently be made valid. The invoice PDF renderer has also read
-- tenant.email / tenant.phone since it was written — the columns simply never
-- existed, so those lines always rendered blank.
--
-- Deliberately on `tenants`, not derived from the creating user: this is the
-- band's published business contact, and putting a member's personal address on
-- a legal document sent to customers would be a privacy problem.
--
-- Nullable with no default: a band that does not want to publish a phone number
-- leaves it empty, and the consumers omit the element rather than emitting a
-- blank one (an empty element is itself invalid — PEPPOL-EN16931-R008).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT;
