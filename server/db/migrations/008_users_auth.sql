ALTER TABLE users
  ADD COLUMN google_sub      TEXT UNIQUE,
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN picture_url     TEXT,
  ADD COLUMN last_login_at   TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "session" (
  sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON "session" (expire);
