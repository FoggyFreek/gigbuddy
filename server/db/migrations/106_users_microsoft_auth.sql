-- Personal Microsoft Account (consumers tenant) sign-in: second OIDC identity
-- slot next to google_sub. Nullable UNIQUE — users may have either or both.
ALTER TABLE users
  ADD COLUMN microsoft_sub TEXT UNIQUE;
