CREATE TABLE venues (
  id             SERIAL PRIMARY KEY,
  category       TEXT NOT NULL DEFAULT 'venue'
                   CHECK (category IN ('venue', 'festival')),
  name           TEXT NOT NULL,
  city           TEXT,
  country        CHAR(2),
  province       CHAR(2),
  address        TEXT,
  website        TEXT,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX venues_name_idx ON venues(name);
CREATE UNIQUE INDEX venues_name_city_uidx
  ON venues(lower(name), lower(coalesce(city, '')));
