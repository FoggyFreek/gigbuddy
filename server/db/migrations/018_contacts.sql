CREATE TABLE contacts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  category    TEXT NOT NULL DEFAULT 'press'
                CHECK (category IN ('press', 'radio & tv', 'booker', 'promotion', 'network')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contacts_name_idx ON contacts (name);
CREATE UNIQUE INDEX contacts_name_category_uidx
  ON contacts (lower(name), lower(category));
