-- Short bio: the 150-char blurb shown on the band's public link page. The
-- existing `bio` stays the long-form text used inside the app; the 150-char cap
-- is enforced in profileValidators.js, like every other bounded profile field.
-- Deliberately not backfilled from `bio` — bands write their own blurb.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS short_bio TEXT;
