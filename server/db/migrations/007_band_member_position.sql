ALTER TABLE band_members
  ADD COLUMN position TEXT NOT NULL DEFAULT 'lead'
    CHECK (position IN ('lead', 'optional', 'sub'));
